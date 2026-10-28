// Detección de tono monofónico (afinador y coach) con autocorrelación normalizada.

/** Devuelve la frecuencia fundamental en Hz, o null si hay silencio o ruido. */
export function detectPitch(buf: Float32Array, sampleRate: number, minHz = 60, maxHz = 1400): number | null {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return null;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.floor(sampleRate / minHz), buf.length - 1);
  const n = buf.length - maxLag;
  const corr = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      sum += buf[i] * buf[i + lag];
      e1 += buf[i] * buf[i];
      e2 += buf[i + lag] * buf[i + lag];
    }
    corr[lag] = sum / Math.sqrt(e1 * e2 || 1);
  }

  // Primer pico que supere el 90% del máximo: evita confundir con armónicos graves.
  let max = 0;
  for (let lag = minLag; lag <= maxLag; lag++) max = Math.max(max, corr[lag]);
  if (max < 0.5) return null;
  let lag = minLag;
  while (lag < maxLag && !(corr[lag] >= max * 0.9 && corr[lag] >= corr[lag + 1])) lag++;

  // Interpolación parabólica para afinar el pico.
  const a = corr[lag - 1] ?? corr[lag];
  const b = corr[lag];
  const c = corr[lag + 1] ?? corr[lag];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sampleRate / (lag + (Number.isFinite(shift) ? shift : 0));
}
