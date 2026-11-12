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

export type InstrumentId = 'guitar' | 'bass' | 'ukulele';

export interface Instrument {
  label: string;
  name: string; // nombre en la partitura
  gm: number; // programa General MIDI (0..127)
  clef: 'treble8' | 'bass8' | 'treble';
  maxFret: number;
}

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guitar: { label: 'Guitarra', name: 'Guitarra', gm: 25, clef: 'treble8', maxFret: 22 },
  bass: { label: 'Bajo', name: 'Bajo', gm: 33, clef: 'bass8', maxFret: 20 },
  ukulele: { label: 'Ukelele', name: 'Ukelele', gm: 24, clef: 'treble', maxFret: 15 },
};

/** Afinaciones en MIDI, por orden de cuerda: de la 6ª a la 1ª en guitarra (en ukelele la 4ª es la de arriba). */
export const TUNINGS: Record<string, { label: string; strings: number[]; instrument: InstrumentId }> = {
  standard: { label: 'Estándar (E A D G B E)', strings: [40, 45, 50, 55, 59, 64], instrument: 'guitar' },
  dropD: { label: 'Drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64], instrument: 'guitar' },
  halfDown: { label: 'Medio tono abajo (Eb)', strings: [39, 44, 49, 54, 58, 63], instrument: 'guitar' },
  fullDown: { label: 'Un tono abajo (D G C F A D)', strings: [38, 43, 48, 53, 57, 62], instrument: 'guitar' },
  dadgad: { label: 'DADGAD', strings: [38, 45, 50, 55, 57, 62], instrument: 'guitar' },
  openG: { label: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62], instrument: 'guitar' },
  openD: { label: 'Open D (D A D F# A D)', strings: [38, 45, 50, 54, 57, 62], instrument: 'guitar' },
  seven: { label: '7 cuerdas (B E A D G B E)', strings: [35, 40, 45, 50, 55, 59, 64], instrument: 'guitar' },
  bass4: { label: 'Bajo 4 cuerdas (E A D G)', strings: [28, 33, 38, 43], instrument: 'bass' },
  bass5: { label: 'Bajo 5 cuerdas (B E A D G)', strings: [23, 28, 33, 38, 43], instrument: 'bass' },
  bassDropD: { label: 'Bajo Drop D (D A D G)', strings: [26, 33, 38, 43], instrument: 'bass' },
  ukulele: { label: 'Ukelele (G C E A)', strings: [67, 60, 64, 69], instrument: 'ukulele' },
  ukuleleLowG: { label: 'Ukelele Sol grave (G C E A)', strings: [55, 60, 64, 69], instrument: 'ukulele' },
  baritone: { label: 'Ukelele barítono (D G B E)', strings: [50, 55, 59, 64], instrument: 'ukulele' },
};
