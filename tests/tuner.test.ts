import { describe, expect, it } from 'vitest';
import { lowpass, yin } from '../src/pitch';

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function tone(f: number, sr: number, n: number, harmonics: number[], noise = 0) {
  return new Float32Array(n).map((_, i) => {
    let v = 0;
    harmonics.forEach((a, k) => (v += a * Math.sin((2 * Math.PI * f * (k + 1) * i) / sr + k)));
    return v * 0.4 + noise * rand();
  });
}

const FREQS = [41.2, 55, 73.42, 82.41, 98, 110, 146.83, 196, 246.94, 329.63, 440, 659.26, 987.77];
const SHAPES: Record<string, number[]> = {
  'tono puro': [1],
  guitarra: [1, 0.6, 0.4, 0.25, 0.15, 0.1],
  'fundamental débil': [0.15, 1, 0.7, 0.4, 0.2],
  'pastilla oscura': [1, 0.2, 0.05],
};

describe('afinador (YIN)', () => {
  for (const sr of [44100, 48000])
    for (const [name, h] of Object.entries(SHAPES))
      it(`${name} @ ${sr} Hz: todas las cuerdas a menos de 2 cents`, () => {
        for (const f of FREQS) {
          const r = yin(tone(f, sr, 8192, h), sr, 35, 1400);
          expect(r, `${f} Hz`).not.toBeNull();
          expect(Math.abs(cents(r!.freq, f)), `${f} Hz leyó ${r!.freq.toFixed(2)}`).toBeLessThan(2);
        }
      });

  it('con ruido fuerte sigue sin errores de octava (< 10 cents)', () => {
    for (const f of [82.41, 110, 196, 329.63]) {
      const r = yin(lowpass(tone(f, 48000, 8192, SHAPES.guitarra, 0.15), 48000, 1000), 48000, 35, 1400);
      expect(Math.abs(cents(r!.freq, f)), `${f}`).toBeLessThan(10);
    }
  });

  it('silencio y ruido blanco no dan nota', () => {
    expect(yin(new Float32Array(8192), 48000)).toBeNull();
    expect(yin(new Float32Array(8192).map(() => rand() * 0.3), 48000)).toBeNull();
  });
});
