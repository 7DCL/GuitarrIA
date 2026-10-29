// Mide la precisión de la transcripción contra notas conocidas (ver make_data.py).
// Se ejecuta en un navegador real con scripts/eval.cjs; el resultado queda en window.__result.
import { analyze, toNotes, type NoiseLevel } from '../src/pipeline';
import type { Mode } from '../src/cleanup';
import { _setBassDominance, chordAt, detectChords } from '../src/chords';

interface Case {
  name: string;
  notes: { start: number; midi: number }[];
  chords?: { start: number; end: number; name: string }[];
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
      const key = `${cfg.noise}|${cfg.autoTune}`;
      if (!cache.has(key)) cache.set(key, await analyze(buffer, cfg, () => {}));
      const prepared = cache.get(key)!;
      if (c.chords) {
        rows.push({ case: c.name, config: cfg.label, cents: Math.round(prepared.cents), chords: chordScore(c.chords, prepared.raw.frames, prepared.rate, cfg.chord) });
        continue;
      }
      const notes = toNotes(prepared, { mode: cfg.mode, sensitivity: cfg.sensitivity, clean: cfg.clean });
      rows.push({ case: c.name, config: cfg.label, cents: Math.round(prepared.cents), ...score(c.notes, notes) });
    }
  }
  (window as unknown as { __result: unknown }).__result = rows;
  document.getElementById('out')!.textContent = JSON.stringify(rows, null, 1);
}

main().catch((e) => ((window as unknown as { __result: unknown }).__result = { error: String(e) }));
