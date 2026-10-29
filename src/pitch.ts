// Detección de tono monofónico (afinador) con el algoritmo YIN.
// YIN busca el periodo con la "diferencia" normalizada más baja y es mucho más robusto que la
// autocorrelación simple frente a errores de octava (cuerdas graves con armónicos fuertes o débiles).

export interface PitchResult {
  freq: number;
  clarity: number; // 0..1, cuánto se parece la señal a un tono puro periódico
}

/** Devuelve la frecuencia fundamental en Hz, o null si hay silencio o ruido. */
export function detectPitch(buf: Float32Array, sampleRate: number, minHz = 60, maxHz = 1400): number | null {
  return yin(buf, sampleRate, minHz, maxHz)?.freq ?? null;
}

export function yin(buf: Float32Array, sampleRate: number, minHz = 60, maxHz = 1400, threshold = 0.12): PitchResult | null {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return null;

  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const w = buf.length - maxTau;
  if (w < 64 || maxTau <= minTau) return null;

  // Función diferencia d(τ) y su versión normalizada acumulada (CMNDF).
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // Primer mínimo por debajo del umbral (el periodo más corto plausible = sin errores de octava baja).
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  // Si nada baja del umbral, el mínimo global solo vale si es claro.
  if (tau < 0) {
    let best = minTau;
    for (let t = minTau; t <= maxTau; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.3) return null;
    tau = best;
  }

  // Interpolación parabólica para precisión por debajo de una muestra.
  // (sobre d(τ) sin normalizar: la normalización acumulada sesga el pico cuando hay ruido)
  const b = cmnd[tau];
  const a = d[tau - 1] ?? d[tau];
  const c = d[tau + 1] ?? d[tau];
  const bd = d[tau];
  const den = a - 2 * bd + c;
  const shift = den !== 0 ? (a - c) / (2 * den) : 0;
  const period = tau + (Math.abs(shift) < 1 ? shift : 0);
  return { freq: sampleRate / period, clarity: Math.max(0, 1 - b) };
}

/** Mediana de una lista corta (suaviza lecturas sueltas erróneas del afinador). */
export function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Paso bajo de 2º orden (biquad) in situ: quita siseo y ruido agudo antes de buscar el tono. */
export function lowpass(buf: Float32Array, sampleRate: number, cutoff = 1000): Float32Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(buf.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}
