import { describe, expect, it } from 'vitest';
import { assignFingering, groupNotes, type Note } from '../src/fingering';
import { toAsciiTab } from '../src/tab';
import { detectChord, TUNINGS } from '../src/theory';
import { detectPitch } from '../src/pitch';
import { parseYouTubeId } from '../src/player';
import { cleanNotes } from '../src/cleanup';
import { estimateCents, noiseGate } from '../src/pipeline';

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

describe('youtube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/123', null],
    ['hola', null],
  ])('%s → %s', (url, id) => expect(parseYouTubeId(url)).toBe(id));
});

describe('preferencias de digitación', () => {
  it('un arpegio de Em grave queda en posición abierta', () => {
    const evs = assignFingering([52, 55, 59, 64, 59, 55, 52].map((m, i) => note(1 + i * 0.5, m)), { tuning: std });
    expect(Math.max(...evs.map((e) => e.notes[0].fret))).toBeLessThanOrEqual(2);
  });
});

describe('limpieza (modo punteo)', () => {
  const n = (start: number, midi: number, velocity = 0.8, duration = 0.3): Note => ({ start, duration, midi, velocity });

  it('quita armónicos de octava y quinta más débiles', () => {
    const out = cleanNotes([n(0, 57), n(0.01, 69, 0.5), n(0.02, 76, 0.4)], { mode: 'lead' });
    expect(out.map((x) => x.midi)).toEqual([57]);
  });

  it('deja una sola nota a la vez, la melodía (aguda)', () => {
    const out = cleanNotes([n(0, 38, 0.9), n(0.02, 69, 0.7)], { mode: 'lead', minMidi: 28 });
    expect(out.map((x) => x.midi)).toEqual([69]);
  });

  it('une re-ataques falsos de una nota sostenida', () => {
    const out = cleanNotes([n(0, 64, 0.8, 0.3), n(0.31, 64, 0.5, 0.4)], { mode: 'lead', merge: true });
    expect(out).toHaveLength(1);
    expect(out[0].duration).toBeCloseTo(0.71, 2);
  });

  it('respeta notas repetidas tocadas de verdad', () => {
    const out = cleanNotes([n(0, 64, 0.8, 0.2), n(0.4, 64, 0.8, 0.2)], { mode: 'lead' });
    expect(out).toHaveLength(2);
  });

  it('descarta notas débiles y muy cortas', () => {
    const out = cleanNotes([n(0, 64, 1), n(0.5, 66, 0.1), n(1, 67, 0.9, 0.02)], { mode: 'lead' });
    expect(out.map((x) => x.midi)).toEqual([64]);
  });

  it('en modo acordes conserva las octavas', () => {
    const out = cleanNotes([n(0, 40), n(0, 47), n(0, 52)], { mode: 'chords' });
    expect(out).toHaveLength(3);
  });
});

describe('afinación del tema', () => {
  const contours = (peak: number) =>
    Array.from({ length: 20 }, () => {
      const row = new Array(264).fill(0);
      const b = Math.floor(peak);
      const f = peak - b;
      row[b] = 1 - f * 0.5;
      row[b + 1] = 0.5 + f * 0.5;
      row[b - 1] = 0.5 - f * 0.4;
      return row;
    });
  it('afinado a 440 da ~0 cents', () => {
    expect(Math.abs(estimateCents({ frames: [], onsets: [], contours: contours(100) }))).toBeLessThan(15);
  });
  it('detecta una grabación alta', () => {
    expect(estimateCents({ frames: [], onsets: [], contours: contours(101) })).toBeGreaterThan(15);
  });
});

describe('filtro de ruido', () => {
  it('atenúa el ruido de fondo y conserva la nota', () => {
    const data = new Float32Array(44100).map((_, i) => (i > 22050 ? Math.sin(i / 10) * 0.5 : (Math.random() - 0.5) * 0.02));
    noiseGate(data, 2);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    expect(rms(data.subarray(5000, 20000))).toBeLessThan(0.003);
    expect(rms(data.subarray(30000, 44000))).toBeGreaterThan(0.3);
  });
});
