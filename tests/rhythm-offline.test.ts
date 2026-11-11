// Afinado offline del ritmo con las notas que la IA detectó en la última evaluación (eval/data/last-run.json).
import { it } from 'vitest';
import fs from 'node:fs';
import { assignFingering } from '../src/fingering';
import { analyzeRhythm, quantize, barTicks } from '../src/rhythm';
it.skipIf(!fs.existsSync('eval/data/last-run.json'))('ritmo offline', () => {
  const rows = JSON.parse(fs.readFileSync('eval/data/last-run.json', 'utf8'));
  const cases = JSON.parse(fs.readFileSync('eval/data/cases.json', 'utf8'));
  for (const row of rows.filter((r: any) => r.rhythm)) {
    const truth = cases.find((c: any) => c.name === row.case).rhythm;
    const { notes, changes } = row.rhythm.input;
    const t0 = performance.now();
    const events = assignFingering(notes, { tuning: [40, 45, 50, 55, 59, 64] });
    const r = analyzeRhythm(events, changes, notes);
    const ms = performance.now() - t0;
    const q = quantize(events, r);
    const counts = new Map<number, number>();
    for (const t of truth.notes) {
      const x = q.find((qq) => Math.abs(events[qq.index].start - t.start) <= 0.07 && events[qq.index].notes.some((n) => n.midi === t.midi));
      if (x) counts.set(x.tick - t.tick, (counts.get(x.tick - t.tick) ?? 0) + 1);
    }
    const [off, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    console.log(row.case.padEnd(22), row.config.padEnd(8), `bpm ${r.bpm} (${truth.bpm})`, `compás ${r.beatsPerBar}/${truth.beatsPerBar}`, `1º ${off % barTicks(r) === 0 ? 'ok' : 'x'}`, `grid ${Math.round((hits / truth.notes.length) * 100)}%`, `${Math.round(ms)}ms`);
  }
});
