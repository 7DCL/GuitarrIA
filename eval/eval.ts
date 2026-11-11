// Mide la precisión de la transcripción contra notas conocidas (ver make_data.py).
// Se ejecuta en un navegador real con scripts/eval.cjs; el resultado queda en window.__result.
import { analyze, toNotes, type NoiseLevel } from '../src/pipeline';
import type { Mode } from '../src/cleanup';
import { _setBassDominance, chordAt, detectChords } from '../src/chords';
import { assignFingering } from '../src/fingering';
import { analyzeRhythm, quantize, barTicks } from '../src/rhythm';

interface Case {
  name: string;
  notes: { start: number; midi: number }[];
  chords?: { start: number; end: number; name: string }[];
  rhythm?: { bpm: number; beatsPerBar: number; downbeat: number; mode: Mode; notes: { start: number; midi: number; tick: number }[] };
}

/**
 * Ritmo: tempo (±4 %, el doble o la mitad cuentan como error), compás, y qué fracción de las notas
 * cae en su semicorchea correcta. Las posiciones se comparan con un desplazamiento común (el primer
 * compás puede empezar antes); si ese desplazamiento es un número entero de compases, el primer
 * tiempo también está bien.
 */
function rhythmScore(truth: NonNullable<Case['rhythm']>, notes: { start: number; duration: number; midi: number; velocity: number }[], frames: number[][], rate: number) {
  const events = assignFingering(notes, { tuning: [40, 45, 50, 55, 59, 64] });
  const chords = detectChords(frames, { timeScale: rate }).filter((c) => c.root >= 0);
  const r = analyzeRhythm(events, chords.map((c) => c.start), notes);
  const q = quantize(events, r);
  const diffs: number[] = [];
  for (const t of truth.notes) {
    const x = q.find((qq) => Math.abs(events[qq.index].start - t.start) <= 0.07 && events[qq.index].notes.some((n) => n.midi === t.midi));
    if (x) diffs.push(x.tick - t.tick);
  }
  const counts = new Map<number, number>();
  for (const d of diffs) counts.set(d, (counts.get(d) ?? 0) + 1);
  const [offset, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  return {
    input: { notes, changes: chords.map((c) => c.start) }, // para afinar el algoritmo sin volver a pasar la IA
    bpm: r.bpm,
    tempoOk: Math.abs(r.bpm - truth.bpm) / truth.bpm < 0.04,
    meterOk: r.beatsPerBar === truth.beatsPerBar,
    downbeatOk: offset % barTicks(r) === 0,
    grid: hits / truth.notes.length,
  };
}

// Reduce un acorde a su tríada mayor/menor (criterio MIREX "majmin").
function majmin(name: string): string {
  if (name === 'N') return 'N';
  const m = name.split('/')[0].match(/^([A-G]#?)(.*)$/)!;
  const minor = /^(m|m7|dim)$/.test(m[2]);
  return m[1] + (minor ? 'm' : '');
}

function chordScore(truth: NonNullable<Case['chords']>, frames: number[][], rate: number, opts: Record<string, number> = {}) {
  _setBassDominance(opts.dominance ?? 2);
  const segs = detectChords(frames, { ...opts, timeScale: rate });
  let n = 0;
  let exact = 0;
  let noBass = 0;
  let mm = 0;
  for (const t of truth)
    for (let x = t.start + 0.05; x < t.end; x += 0.1) {
      const got = chordAt(segs, x)?.name ?? 'N';
      n++;
      if (got === t.name) exact++;
      if (got.split('/')[0] === t.name.split('/')[0]) noBass++;
      if (majmin(got) === majmin(t.name)) mm++;
    }
  return { exact: exact / n, noBass: noBass / n, majmin: mm / n, got: segs.filter((s) => s.name !== 'N').map((s) => s.name).join(' ') };
}
interface Config {
  label: string;
  noise: NoiseLevel;
  autoTune: boolean;
  mode: Mode;
  sensitivity: number;
  clean?: Record<string, unknown>;
  chord?: Record<string, number>;
  separate?: 'off' | 'drums' | 'full';
  only?: string; // solo los casos cuyo nombre empieza así
}

const TOL = 0.07; // segundos de margen en el inicio de la nota

function score(truth: Case['notes'], got: { start: number; midi: number }[]) {
  const used = new Set<number>();
  let hits = 0;
  for (const t of truth) {
    const j = got.findIndex((g, k) => !used.has(k) && g.midi === t.midi && Math.abs(g.start - t.start) <= TOL);
    if (j >= 0) {
      used.add(j);
      hits++;
    }
  }
  const precision = got.length ? hits / got.length : 0;
  const recall = truth.length ? hits / truth.length : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { hits, truth: truth.length, got: got.length, precision, recall, f1 };
}

async function main() {
  const params = new URLSearchParams(location.search);
  const configs: Config[] = JSON.parse(params.get('configs') ?? '[]');
  const only = params.get('only') ?? '';
  const cases: Case[] = (await (await fetch('./data/cases.json')).json()).filter((c: Case) => c.name.startsWith(only));
  const ctx = new AudioContext();
  const rows: Record<string, unknown>[] = [];
  for (const c of cases) {
    const buffer = await ctx.decodeAudioData(await (await fetch(`./data/${c.name}.wav`)).arrayBuffer());
    const cache = new Map<string, Awaited<ReturnType<typeof analyze>>>();
    for (const cfg of configs) {
      if (cfg.only && !c.name.startsWith(cfg.only)) continue;
      const key = `${cfg.noise}|${cfg.autoTune}|${cfg.separate ?? 'off'}`;
      if (!cache.has(key)) cache.set(key, await analyze(buffer, cfg, () => {}));
      const prepared = cache.get(key)!;
      if (c.rhythm) {
        const notes = toNotes(prepared, { mode: c.rhythm.mode, sensitivity: cfg.sensitivity, clean: cfg.clean });
        rows.push({ case: c.name, config: cfg.label, rhythm: rhythmScore(c.rhythm, notes, prepared.raw.frames, prepared.rate) });
      }
      if (c.chords) {
        rows.push({ case: c.name, config: cfg.label, cents: Math.round(prepared.cents), chords: chordScore(c.chords, prepared.raw.frames, prepared.rate, cfg.chord) });
        continue;
      }
      if (!c.notes.length) continue;
      const notes = toNotes(prepared, { mode: cfg.mode, sensitivity: cfg.sensitivity, clean: cfg.clean });
      rows.push({ case: c.name, config: cfg.label, cents: Math.round(prepared.cents), ...score(c.notes, notes) });
    }
  }
  (window as unknown as { __result: unknown }).__result = rows;
  document.getElementById('out')!.textContent = JSON.stringify(rows, null, 1);
}

main().catch((e) => ((window as unknown as { __result: unknown }).__result = { error: String(e) }));
