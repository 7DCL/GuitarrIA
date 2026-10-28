// Teoría musical básica: nombres de notas, afinaciones y detección de acordes.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number, withOctave = false): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Afinaciones en MIDI, de la cuerda más grave a la más aguda. */
export const TUNINGS: Record<string, { label: string; strings: number[] }> = {
  standard: { label: 'Estándar (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] },
  dropD: { label: 'Drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64] },
  halfDown: { label: 'Medio tono abajo (Eb)', strings: [39, 44, 49, 54, 58, 63] },
  dadgad: { label: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] },
  openG: { label: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62] },
  bass4: { label: 'Bajo 4 cuerdas (E A D G)', strings: [28, 33, 38, 43] },
};

const CHORD_SHAPES: { suffix: string; intervals: number[] }[] = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: 'sus2', intervals: [0, 2, 7] },
  { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'aug', intervals: [0, 4, 8] },
  { suffix: '5', intervals: [0, 7] },
];

/** Nombra un acorde a partir de sus notas MIDI. Devuelve null si no se reconoce. */
export function detectChord(midis: number[]): string | null {
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))];
  if (pcs.length < 2) return null;
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  let best: { name: string; score: number } | null = null;
  for (const root of pcs) {
    const rel = new Set(pcs.map((p) => (p - root + 12) % 12));
    for (const shape of CHORD_SHAPES) {
      if (!shape.intervals.every((i) => rel.has(i))) continue;
      // Más notas cubiertas y menos notas sobrantes = mejor; preferir raíz en el bajo.
      const extra = rel.size - shape.intervals.length;
      const score = shape.intervals.length * 2 - extra * 3 + (root === bass ? 1 : 0);
      if (extra > 1) continue;
      if (!best || score > best.score) {
        const slash = root !== bass ? `/${NOTE_NAMES[bass]}` : '';
        best = { name: NOTE_NAMES[root] + shape.suffix + slash, score };
      }
    }
  }
  return best?.name ?? null;
}
