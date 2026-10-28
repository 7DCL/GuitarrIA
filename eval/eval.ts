// Mide la precisión de la transcripción contra notas conocidas (ver make_data.py).
// Se ejecuta en un navegador real con scripts/eval.cjs; el resultado queda en window.__result.
import { analyze, toNotes, type NoiseLevel } from '../src/pipeline';
import type { Mode } from '../src/cleanup';

interface Case {
  name: string;
  notes: { start: number; midi: number }[];
}
interface Config {
  label: string;
  noise: NoiseLevel;
  autoTune: boolean;
  mode: Mode;
  sensitivity: number;
  clean?: Record<string, unknown>;
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
  const cases: Case[] = await (await fetch('./data/cases.json')).json();
  const ctx = new AudioContext();
  const rows: Record<string, unknown>[] = [];
  for (const c of cases) {
    const buffer = await ctx.decodeAudioData(await (await fetch(`./data/${c.name}.wav`)).arrayBuffer());
    const cache = new Map<string, Awaited<ReturnType<typeof analyze>>>();
    for (const cfg of configs) {
      const key = `${cfg.noise}|${cfg.autoTune}`;
      if (!cache.has(key)) cache.set(key, await analyze(buffer, cfg, () => {}));
      const prepared = cache.get(key)!;
      const notes = toNotes(prepared, { mode: cfg.mode, sensitivity: cfg.sensitivity, clean: cfg.clean });
      rows.push({ case: c.name, config: cfg.label, cents: Math.round(prepared.cents), ...score(c.notes, notes) });
    }
  }
  (window as unknown as { __result: unknown }).__result = rows;
  document.getElementById('out')!.textContent = JSON.stringify(rows, null, 1);
}

main().catch((e) => ((window as unknown as { __result: unknown }).__result = { error: String(e) }));
