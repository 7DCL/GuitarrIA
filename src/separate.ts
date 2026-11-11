// Separación aproximada de la guitarra en una canción completa, sin servidor ni modelos pesados:
//  1) quita la batería (separación armónico/percusiva por filtros de mediana, Fitzgerald 2010);
//  2) opcionalmente quita lo que suena en el centro de la mezcla estéreo (voz, bajo, bombo),
//     porque las guitarras suelen ir paneadas a los lados.
// Trabaja en el dominio de la frecuencia con máscaras suaves y reconstruye por solapamiento.

const N = 2048;
const HOP = 512;

/** FFT compleja in situ (radix 2). `re` e `im` de longitud potencia de 2. */
export function fft(re: Float32Array, im: Float32Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

const hann = (() => {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  return w;
})();

/** Espectro de un frame (ventana de Hann centrada en f·HOP). Escribe en `re`/`im` (longitud N). */
function frameFFT(x: Float32Array, f: number, re: Float32Array, im: Float32Array): void {
  const start = f * HOP - N / 2;
  for (let k = 0; k < N; k++) {
    const s = start + k;
    re[k] = s >= 0 && s < x.length ? x[s] * hann[k] : 0;
    im[k] = 0;
  }
  fft(re, im);
}

/** Mediana de una ventana deslizante (por selección parcial; los tamaños son pequeños). */
function median(buf: Float32Array, len: number): number {
  const a = buf.subarray(0, len);
  a.sort();
  return a[len >> 1];
}

export interface SeparateOptions {
  drums: boolean; // quitar percusión
  center: boolean; // quitar lo que está en el centro (necesita estéreo)
  onProgress?: (p: number) => void;
}

/**
 * Devuelve la mezcla mono con la guitarra realzada. `left`/`right` a la misma frecuencia de muestreo;
 * si solo hay un canal, pasa el mismo array dos veces (la opción `center` entonces no hace nada).
 */
export async function separateGuitar(left: Float32Array, right: Float32Array, opts: SeparateOptions): Promise<Float32Array> {
  const length = left.length;
  const stereo = left !== right && opts.center;
  const mono = new Float32Array(length);
  for (let s = 0; s < length; s++) mono[s] = 0.5 * (left[s] + right[s]);
  const frames = Math.max(1, Math.ceil(length / HOP) + 1);
  const bins = N / 2 + 1;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const tick = async (p: number) => {
    opts.onProgress?.(p);
    await new Promise((r) => setTimeout(r, 0)); // deja respirar a la interfaz
  };

  // 1ª pasada: magnitudes (solo esto se guarda entero: ~40 MB para 4 minutos).
  const mag: Float32Array[] = [];
  if (opts.drums)
    for (let f = 0; f < frames; f++) {
      frameFFT(mono, f, re, im);
      const m = new Float32Array(bins);
      for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k]);
      mag.push(m);
      if (f % 400 === 0) await tick((0.3 * f) / frames);
    }

  // 2ª pasada: máscara, espectro filtrado y reconstrucción por solapamiento.
  const y = new Float32Array(length);
  const norm = new Float32Array(length);
  const lre = new Float32Array(N), lim = new Float32Array(N), rre = new Float32Array(N), rim = new Float32Array(N);
  const HK = 17; // ventana en el tiempo (frames): sonidos sostenidos
  const PK = 17; // ventana en frecuencia (bins): golpes
  const buf = new Float32Array(Math.max(HK, PK));
  const keep = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    keep.fill(1);
    if (opts.drums) {
      const cur = mag[f];
      for (let k = 0; k < bins; k++) {
        let n = 0;
        for (let d = -(HK >> 1); d <= HK >> 1; d++) {
          const g = f + d;
          buf[n++] = g >= 0 && g < frames ? mag[g][k] : 0;
        }
        const harm = median(buf, n);
        n = 0;
        for (let d = -(PK >> 1); d <= PK >> 1; d++) {
          const b = k + d;
          buf[n++] = b >= 0 && b < bins ? cur[b] : 0;
        }
        const perc = median(buf, n);
        const h2 = harm * harm;
        keep[k] = h2 + perc * perc > 1e-12 ? h2 / (h2 + perc * perc) : 1;
      }
    }
    if (stereo) {
      // Similitud entre canales: 1 = suena igual en los dos lados (centro). Se atenúa el centro.
      frameFFT(left, f, lre, lim);
      frameFFT(right, f, rre, rim);
      for (let k = 0; k < bins; k++) {
        const pl = lre[k] * lre[k] + lim[k] * lim[k];
        const pr = rre[k] * rre[k] + rim[k] * rim[k];
        const cross = Math.hypot(lre[k] * rre[k] + lim[k] * rim[k], lim[k] * rre[k] - lre[k] * rim[k]);
        const sim = pl + pr > 1e-12 ? (2 * cross) / (pl + pr) : 1;
        // Suave: deja pasar algo del centro (una guitarra centrada no desaparece del todo).
        keep[k] *= Math.min(1, Math.max(0.15, (1 - sim) * 4));
      }
    }
    frameFFT(mono, f, re, im);
    for (let k = 0; k < bins; k++) {
      re[k] *= keep[k];
      im[k] *= keep[k];
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    fft(re, im, true);
    const start = f * HOP - N / 2;
    for (let k = 0; k < N; k++) {
      const s = start + k;
      if (s < 0 || s >= length) continue;
      y[s] += re[k] * hann[k];
      norm[s] += hann[k] * hann[k];
    }
    if (f % 200 === 0) await tick(0.3 + (0.7 * f) / frames);
  }
  for (let s = 0; s < length; s++) if (norm[s] > 1e-6) y[s] /= norm[s];
  opts.onProgress?.(1);
  return y;
}
