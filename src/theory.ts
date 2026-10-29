// Teoría musical básica: nombres de notas y afinaciones.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LATIN_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const LATIN_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];

export type Notation = 'sharp' | 'flat' | 'latin' | 'latinFlat';
let notation: Notation = 'sharp';

/** Cambia cómo se escriben las notas en toda la app (C D E o Do Re Mi, sostenidos o bemoles). */
export function setNotation(n: Notation): void {
  notation = n;
}

export function pcName(pc: number, n: Notation = notation): string {
  const i = ((pc % 12) + 12) % 12;
  return { sharp: NOTE_NAMES, flat: FLAT_NAMES, latin: LATIN_SHARP, latinFlat: LATIN_FLAT }[n][i];
}

export function noteName(midi: number, withOctave = false): string {
  const name = pcName(midi);
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

/** Nombre de acorde con la notación elegida, p. ej. raíz 9 + 'm' + bajo 0 → "Am/C" o "Lam/Do". */
export function chordName(root: number, quality: string, bass = root): string {
  if (root < 0) return '–';
  return pcName(root) + quality + (bass !== root && bass >= 0 ? `/${pcName(bass)}` : '');
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
