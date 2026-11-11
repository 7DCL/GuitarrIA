import { describe, expect, it } from 'vitest';
import { fft, separateGuitar } from '../src/separate';

const SR = 22050;
const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};

describe('separación', () => {
  it('FFT ida y vuelta', () => {
    const re = new Float32Array(16).map((_, i) => Math.sin(i));
    const im = new Float32Array(16);
    const orig = re.slice();
    fft(re, im);
    fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i], 5));
  });

  it('sin opciones devuelve la misma señal', async () => {
    const x = new Float32Array(SR).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / SR) * 0.5);
    const y = await separateGuitar(x, x, { drums: false, center: false });
    for (let i = 3000; i < 18000; i += 997) expect(y[i]).toBeCloseTo(x[i], 3);
  });

  it('quita golpes de batería y conserva una nota sostenida', async () => {
    const tone = new Float32Array(SR * 2).map((_, i) => Math.sin((2 * Math.PI * 330 * i) / SR) * 0.3);
    const clicks = new Float32Array(SR * 2);
    for (let c = 0; c < 8; c++) for (let i = 0; i < 300; i++) clicks[c * 5000 + 1000 + i] = (Math.random() * 2 - 1) * Math.exp(-i / 60);
    const mix = tone.map((v, i) => v + clicks[i]);
    const y = await separateGuitar(mix, mix, { drums: true, center: false });
    const residual = y.map((v, i) => v - tone[i]);
    expect(rms(residual, 2000, 40000)).toBeLessThan(rms(clicks, 2000, 40000) * 0.6);
    expect(rms(y, 2000, 40000)).toBeGreaterThan(rms(tone) * 0.8);
  });

  it('quita lo que está en el centro y deja lo paneado', async () => {
    const n = SR * 2;
    const center = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 150 * i) / SR) * 0.4);
    const guitar = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 523 * i) / SR) * 0.4);
    const left = center.map((v, i) => v + guitar[i]);
    const right = center.slice();
    const y = await separateGuitar(left, right, { drums: false, center: true });
    // Energía en 150 Hz frente a 523 Hz por correlación con cada seno.
    const corr = (f: number) => {
      let s = 0;
      for (let i = 4000; i < n - 4000; i++) s += y[i] * Math.sin((2 * Math.PI * f * i) / SR);
      return Math.abs(s);
    };
    expect(corr(150)).toBeLessThan(corr(523) * 0.4);
  });
});
