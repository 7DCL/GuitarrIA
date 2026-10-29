import { describe, expect, it } from 'vitest';
import { chordAt, detectChords, framesFromNotes } from '../src/chords';
import { findVoicing } from '../src/voicing';
import { interpret } from '../src/tuner';
import { toAsciiTab } from '../src/tab';
import { formatTime, safeFileName } from '../src/util';
import { chordName, setNotation } from '../src/theory';

// Acorde = notas MIDI que suenan juntas durante `dur` segundos.
const strum = (start: number, dur: number, midis: number[]) => midis.map((midi) => ({ start, duration: dur, midi, velocity: 0.8 }));
const names = (segs: ReturnType<typeof detectChords>) => segs.filter((s) => s.root >= 0).map((s) => s.name);

describe('detectChords', () => {
  it('reconoce una progresión C G Am F', () => {
    const notes = [
      ...strum(0, 2, [48, 52, 55, 60, 64]),
      ...strum(2, 2, [43, 47, 50, 55, 59, 67]),
      ...strum(4, 2, [45, 52, 57, 60, 64]),
      ...strum(6, 2, [41, 48, 53, 57, 60, 65]),
    ];
    expect(names(detectChords(framesFromNotes(notes)))).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('distingue séptimas y escribe inversiones', () => {
    const notes = [...strum(0, 2, [43, 47, 50, 53, 59]), ...strum(2, 2, [40, 48, 52, 55, 60, 64])];
    expect(names(detectChords(framesFromNotes(notes)))).toEqual(['G7', 'C/E']);
  });

  it('no inventa acordes en el silencio', () => {
    const notes = [...strum(0, 1.5, [45, 52, 57, 60, 64]), ...strum(4, 1.5, [40, 47, 52, 55, 59, 64])];
    const segs = detectChords(framesFromNotes(notes));
    expect(chordAt(segs, 0.7)?.name).toBe('Am');
    expect(chordAt(segs, 3)?.root).toBe(-1);
    expect(chordAt(segs, 4.7)?.name).toBe('Em');
  });
});

describe('findVoicing', () => {
  const std = [40, 45, 50, 55, 59, 64];
  const shape = (root: number, q: string, bass = root) => findVoicing(root, q, bass, std)!.frets.map((f) => (f < 0 ? 'x' : f)).join('');
  it('da las digitaciones habituales', () => {
    expect(shape(0, '')).toBe('x32010');
    expect(shape(7, '')).toBe('320003');
    expect(shape(9, 'm')).toBe('x02210');
    expect(shape(5, '')).toBe('133211');
    expect(shape(2, '', 6)).toBe('200232');
  });
});

describe('interpret (afinador)', () => {
  const opts = { a4: 440, strings: [40, 45, 50, 55, 59, 64], lockedString: null, minHz: 60 };
  it('elige la cuerda más cercana y mide los cents', () => {
    const r = interpret(110 * 2 ** (10 / 1200), opts);
    expect(r.target).toBe(45);
    expect(r.cents).toBeCloseTo(10, 5);
  });
  it('respeta el La de referencia', () => {
    expect(interpret(432, { ...opts, a4: 432 }).nearest).toBe(69);
    expect(Math.abs(interpret(432, { ...opts, a4: 432 }).cents)).toBeLessThan(0.01);
  });
  it('con una cuerda fija mide contra ella aunque suene lejos', () => {
    const r = interpret(82.41, { ...opts, lockedString: 1 });
    expect(r.target).toBe(45);
    expect(r.cents).toBeLessThan(-400);
  });
  it('modo cromático lejos de cualquier cuerda', () => {
    expect(interpret(440 * 2 ** (6 / 12), opts).target).toBeNull();
  });
});

describe('utilidades', () => {
  it('tab de texto con línea de acordes', () => {
    const ev = (start: number, string: number, fret: number) => ({ start, end: start + 0.5, notes: [{ start, duration: 0.5, midi: 0, velocity: 1, string, fret }] });
    const txt = toAsciiTab([ev(0, 4, 1), ev(1, 3, 2)], [40, 45, 50, 55, 59, 64], 72, ['C', 'G']);
    expect(txt.split('\n')[0].trim()).toBe('C G');
  });
  it('formatTime aguanta valores raros', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(65.37, true)).toBe('1:05.3');
  });
  it('nombres de archivo seguros', () => {
    expect(safeFileName('AC/DC: Back in Black?')).toBe('AC DC Back in Black');
  });
  it('notación latina y bemoles', () => {
    setNotation('latin');
    expect(chordName(9, 'm', 0)).toBe('Lam/Do');
    setNotation('flat');
    expect(chordName(10, '7')).toBe('Bb7');
    setNotation('sharp');
  });
});
