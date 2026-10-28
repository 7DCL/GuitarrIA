import { describe, expect, it } from 'vitest';
import { assignFingering, groupNotes, type Note } from '../src/fingering';
import { toAsciiTab } from '../src/tab';
import { detectChord, TUNINGS } from '../src/theory';
import { detectPitch } from '../src/pitch';

const std = TUNINGS.standard.strings;
const note = (start: number, midi: number): Note => ({ start, duration: 0.4, midi, velocity: 0.8 });

describe('fingering', () => {
  it('agrupa notas simultáneas en acordes', () => {
    const g = groupNotes([note(0, 40), note(0.02, 47), note(0.5, 52)]);
    expect(g.map((x) => x.length)).toEqual([2, 1]);
  });

  it('digita un acorde de Mi mayor abierto', () => {
    const [ev] = assignFingering([40, 47, 52, 56, 59, 64].map((m) => note(0, m)), { tuning: std });
    expect(ev.notes.map((n) => n.fret)).toEqual([0, 2, 2, 1, 0, 0]);
  });

  it('cada nota en una cuerda distinta y altura correcta', () => {
    const evs = assignFingering([note(0, 48), note(0, 52), note(0, 55)], { tuning: std });
    const strings = evs[0].notes.map((n) => n.string);
    expect(new Set(strings).size).toBe(3);
    for (const n of evs[0].notes) expect(std[n.string] + n.fret).toBe(n.midi);
  });

  it('una escala se mantiene en una posición sin saltos grandes', () => {
    const scale = [57, 59, 60, 62, 64, 65, 67, 69].map((m, i) => note(i * 0.2, m));
    const evs = assignFingering(scale, { tuning: std });
    const frets = evs.map((e) => e.notes[0].fret).filter((f) => f > 0);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5);
  });

  it('respeta el capo', () => {
    const [ev] = assignFingering([note(0, 42)], { tuning: std, capo: 2 });
    expect(ev.notes[0]).toMatchObject({ string: 0, fret: 0 });
  });

  it('descarta notas fuera de rango', () => {
    expect(assignFingering([note(0, 20)], { tuning: std })).toEqual([]);
  });
});

describe('tab', () => {
  it('pone la cuerda aguda arriba', () => {
    const evs = assignFingering([note(0, 64), note(1, 40)], { tuning: std });
    const lines = toAsciiTab(evs, std).split('\n');
    expect(lines[0]).toBe('e|-0---|');
    expect(lines[5]).toBe('E|---0-|');
  });
});

describe('acordes', () => {
  it.each([
    [[48, 52, 55], 'C'],
    [[45, 52, 57, 60, 64], 'Am'],
    [[43, 47, 50, 53], 'G7'],
    [[40, 47], 'E5'],
    [[52, 55, 60], 'C/E'],
  ])('%j → %s', (midis, name) => expect(detectChord(midis)).toBe(name));
});

describe('afinador', () => {
  it.each([82.41, 110, 196, 329.63])('detecta %f Hz', (f) => {
    const sr = 44100;
    const buf = new Float32Array(4096).map((_, i) =>
      0.5 * Math.sin((2 * Math.PI * f * i) / sr) + 0.25 * Math.sin((4 * Math.PI * f * i) / sr),
    );
    expect(detectPitch(buf, sr)!).toBeCloseTo(f, 0);
  });

  it('silencio devuelve null', () => expect(detectPitch(new Float32Array(2048), 44100)).toBeNull());
});
