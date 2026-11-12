import { describe, expect, it } from 'vitest';
import type { Event } from '../src/fingering';
import { analyzeRhythm, detectKey, quantize, splitDuration, tickToTime, timeToTick, withTempo, TPQ } from '../src/rhythm';

/** Eventos sintéticos: una nota por cada tiempo dado en negras, a un tempo. */
function evs(beats: number[], bpm: number, start = 0.5, midi = (i: number) => 52 + (i % 5) * 2, jitter = 0): Event[] {
  const p = 60 / bpm;
  return beats.map((b, i) => {
    const t = start + b * p + (jitter ? Math.sin(i * 12.9898) * jitter : 0);
    const m = midi(i);
    return { start: t, end: t + p * 0.9, notes: [{ start: t, duration: p * 0.9, midi: m, velocity: i % 4 === 0 ? 0.9 : 0.6, string: 2, fret: 2 }] };
  });
}

describe('ritmo', () => {
  it('detecta el tempo de un patrón de negras y corcheas', () => {
    for (const bpm of [72, 96, 120, 140]) {
      const pattern: number[] = [];
      for (let bar = 0; bar < 8; bar++) pattern.push(bar * 4, bar * 4 + 1, bar * 4 + 2, bar * 4 + 2.5, bar * 4 + 3);
      const r = analyzeRhythm(evs(pattern, bpm, 0.5, undefined, 0.01));
      expect(Math.abs(r.bpm - bpm) / bpm).toBeLessThan(0.04);
    }
  });

  it('cuantiza a semicorcheas con figuras correctas', () => {
    const pattern = [0, 1, 2, 2.5, 3, 4, 6];
    const e = evs(pattern, 100, 0.3, undefined, 0.012);
    const r = withTempo(analyzeRhythm(e), 100, 10);
    const q = quantize(e, r);
    const first = q[0].tick;
    expect(q.map((x) => (x.tick - first) / TPQ)).toEqual(pattern);
    expect(q[2].dur).toBe(2); // corchea antes de la siguiente nota
  });

  it('tiempo ↔ ticks ida y vuelta', () => {
    const r = withTempo(analyzeRhythm(evs([0, 1, 2, 3, 4, 5, 6, 7], 90)), 90, 10);
    for (const t of [0.7, 1.33, 4.2]) expect(tickToTime(r, timeToTick(r, t))).toBeCloseTo(t, 6);
  });

  it('parte las duraciones sin cruzar la barra y con figuras legibles', () => {
    expect(splitDuration(0, 16, 16)).toEqual([{ tick: 0, ticks: 16 }]);
    expect(splitDuration(12, 8, 16)).toEqual([{ tick: 12, ticks: 4 }, { tick: 16, ticks: 4 }]);
    expect(splitDuration(0, 5, 16).map((x) => x.ticks)).toEqual([4, 1]);
    expect(splitDuration(0, 6, 16).map((x) => x.ticks)).toEqual([6]);
  });

  it('detecta compás de 3/4 con acordes que cambian cada 3 tiempos', () => {
    const pattern: number[] = [];
    for (let b = 0; b < 24; b++) pattern.push(b);
    const e = evs(pattern, 110, 0.4, (i) => (i % 3 === 0 ? 40 : 59));
    e.forEach((ev, i) => i % 3 === 0 && ev.notes.push({ ...ev.notes[0], midi: 47 }, { ...ev.notes[0], midi: 52 }));
    const changes = pattern.filter((b) => b % 3 === 0).map((b) => 0.4 + (b * 60) / 110);
    const r = analyzeRhythm(e, changes);
    expect(r.beatsPerBar).toBe(3);
    expect(r.bpm).toBeGreaterThan(100);
  });

  it('detecta la tonalidad', () => {
    const scale = (root: number, steps: number[]) => steps.map((s) => ({ midi: root + s, duration: 0.5, velocity: 0.8 }));
    expect(detectKey(scale(55, [0, 2, 4, 5, 7, 9, 11, 0, 4, 7, 0, 7])).key).toBe(1); // Sol mayor
    const am = detectKey(scale(57, [0, 2, 3, 5, 7, 8, 10, 0, 3, 7, 0, 7, 0, 3]));
    expect(am.minor).toBe(true);
    expect(am.key).toBe(0); // La menor
  });
});
