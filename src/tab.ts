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

/**
 * Tab en texto: la cuerda aguda arriba, una columna por evento, filas de `width` caracteres.
 * `chords[i]` (opcional) es el acorde que empieza en el evento i: se escribe en una línea encima.
 */
export function toAsciiTab(events: Event[], tuning: number[], width = 72, chords: (string | null)[] = []): string {
  const labels = stringLabels(tuning);
  const pad = Math.max(...labels.map((l) => l.length));
  const rows: string[][] = tuning.map(() => []);
  let chordLine = '';
  const blocks: string[] = [];
  let used = 0;

  const flush = () => {
    if (!used) return;
    const lines = tuning.map((_, s) => `${labels[s].padEnd(pad)}|${rows[s].join('')}-|`).reverse();
    if (chordLine.trim()) lines.unshift(' '.repeat(pad + 1) + chordLine.trimEnd());
    blocks.push(lines.join('\n'));
    rows.forEach((r) => (r.length = 0));
    chordLine = '';
    used = 0;
  };

  events.forEach((ev, i) => {
    const cells = tuning.map((_, s) => {
      const n = ev.notes.find((x) => x.string === s);
      return n ? String(n.fret) : '';
    });
    const w = Math.max(...cells.map((c) => c.length)) + 1;
    if (used + w > width) flush();
    // Si el nombre del acorde anterior aún no cabe, se rellena con guiones para no pisarlo.
    const name = chords[i];
    if (name) chordLine = chordLine.padEnd(used, ' ') + (chordLine.length > used ? ' ' : '') + name;
    cells.forEach((c, s) => rows[s].push('-' + c.padEnd(w - 1, '-')));
    used += w;
  });
  flush();
  return blocks.join('\n\n');
}
