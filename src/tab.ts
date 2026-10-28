// Genera tablatura ASCII a partir de los eventos digitados.
import type { Event } from './fingering';
import { noteName } from './theory';

export function stringLabels(tuning: number[]): string[] {
  // Cuerda más aguda en minúscula, como en las tabs clásicas.
  return tuning.map((m, i) => {
    const n = noteName(m);
    return i === tuning.length - 1 && tuning.length >= 6 ? n.toLowerCase() : n;
  });
}

/** Tab en texto: la cuerda aguda arriba, una columna por evento, filas de `width` caracteres. */
export function toAsciiTab(events: Event[], tuning: number[], width = 72): string {
  const labels = stringLabels(tuning);
  const pad = Math.max(...labels.map((l) => l.length));
  const rows: string[][] = tuning.map(() => []);
  const blocks: string[] = [];
  let used = 0;

  const flush = () => {
    if (!used) return;
    const lines = tuning
      .map((_, s) => `${labels[s].padEnd(pad)}|${rows[s].join('')}-|`)
      .reverse();
    blocks.push(lines.join('\n'));
    rows.forEach((r) => (r.length = 0));
    used = 0;
  };

  for (const ev of events) {
    const cells = tuning.map((_, s) => {
      const n = ev.notes.find((x) => x.string === s);
      return n ? String(n.fret) : '';
    });
    const w = Math.max(...cells.map((c) => c.length)) + 1;
    if (used + w > width) flush();
    cells.forEach((c, s) => rows[s].push('-' + c.padEnd(w - 1, '-')));
    used += w;
  }
  flush();
  return blocks.join('\n\n');
}
