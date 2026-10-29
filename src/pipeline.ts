// Cadena completa audio → notas: limpieza del audio, afinación, IA y limpieza de notas.
import { cleanNotes, type CleanOptions, type Mode } from './cleanup';
import type { Note } from './fingering';
import { extractNotes, runModel, type RawOutput } from './transcribe';

export type NoiseLevel = 'off' | 'normal' | 'strong';

export interface Prepared {
  raw: RawOutput;
  rate: number; // velocidad aplicada para corregir la afinación (los tiempos se multiplican por ella)
  cents: number; // desafinación detectada respecto a La 440
}

const SR = 22050;

/** Filtra el audio antes de la IA: quita graves (zumbido), agudos sin guitarra y el ruido de fondo. */
export async function denoise(buffer: AudioBuffer, level: NoiseLevel, rate = 1, lowCut = 70): Promise<AudioBuffer> {
  const length = Math.ceil((buffer.duration / rate) * SR);
  const ctx = new OfflineAudioContext(1, length, SR);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  let node: AudioNode = src;
  if (level !== 'off') {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = lowCut; // por debajo de la cuerda más grave solo hay zumbido y golpes
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = level === 'strong' ? 4500 : 7000;
    node.connect(hp);
    hp.connect(lp);
    node = lp;
  }
  node.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  if (level !== 'off') noiseGate(out.getChannelData(0), level === 'strong' ? 3 : 1.8);
  return out;
}

/** Atenúa los tramos cuyo volumen está cerca del ruido de fondo (estimado como el percentil 10). */
export function noiseGate(data: Float32Array, ratio: number, win = 512): void {
  const n = Math.ceil(data.length / win);
  const rms = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let s = 0;
    const end = Math.min(data.length, (w + 1) * win);
    for (let i = w * win; i < end; i++) s += data[i] * data[i];
    rms[w] = Math.sqrt(s / (end - w * win));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.1)] || 0;
  const mid = sorted[Math.floor(n * 0.5)] || 0;
  // Sin silencios claros (el "suelo" se parece al volumen típico) no hay ruido que separar.
  if (floor <= 0 || floor > mid * 0.5) return;
  const threshold = floor * ratio;
  let gain = 1;
  for (let w = 0; w < n; w++) {
    const target = rms[w] > threshold ? 1 : Math.max(0.1, (rms[w] / threshold) ** 2); // como mucho −20 dB
    const end = Math.min(data.length, (w + 1) * win);
    for (let i = w * win; i < end; i++) {
      gain += (target - gain) * 0.01; // suavizado para no crear chasquidos
      data[i] *= gain;
    }
  }
}

/**
 * Estima cuántos cents está desafinada la grabación respecto a La 440 usando el contorno
 * fino de la IA (3 bins por semitono). Muchos temas están afinados a 432 Hz o un poco altos/bajos,
 * y eso hace que la IA confunda notas por un semitono.
 */
export function estimateCents(raw: RawOutput): number {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (const row of raw.contours) {
    for (let b = 1; b < row.length - 1; b++) {
      const v = row[b];
      if (v < 0.5 || v < row[b - 1] || v < row[b + 1]) continue;
      // Interpolación parabólica del pico para tener resolución fina.
      const den = row[b - 1] - 2 * v + row[b + 1];
      const shift = den ? (0.5 * (row[b - 1] - row[b + 1])) / den : 0;
      const semis = (b + shift - 1) / 3; // el bin central de cada semitono es 3k+1
      const dev = semis - Math.round(semis); // -0.5..0.5 semitonos
      const ang = dev * 2 * Math.PI;
      sx += Math.cos(ang) * v;
      sy += Math.sin(ang) * v;
      total += v;
    }
  }
  if (total < 1) return 0;
  return (Math.atan2(sy, sx) / (2 * Math.PI)) * 100;
}

/** Analiza el audio. Si está desafinado más de `tolerance` cents, lo corrige y vuelve a analizar. */
export async function analyze(
  buffer: AudioBuffer,
  opts: { noise: NoiseLevel; autoTune: boolean; tolerance?: number; lowestMidi?: number },
  onProgress: (pct: number, label: string) => void,
): Promise<Prepared> {
  // Corte de graves un poco por debajo de la cuerda más grave (Mi 82 Hz en guitarra, Mi 41 Hz en bajo).
  const lowCut = Math.max(25, 440 * 2 ** (((opts.lowestMidi ?? 40) - 69) / 12) * 0.8);
  let first: RawOutput | null = await runModel(await denoise(buffer, opts.noise, 1, lowCut), (p) => onProgress(p, 'Transcribiendo'));
  const cents = estimateCents(first);
  if (!opts.autoTune || Math.abs(cents) < (opts.tolerance ?? 20)) return { raw: first, rate: 1, cents };
  first = null; // libera memoria antes de la segunda pasada
  // Reproducir más lento baja el tono: rate = 2^(-cents/1200) lleva la grabación a La 440.
  const rate = Math.pow(2, -cents / 1200);
  const raw = await runModel(await denoise(buffer, opts.noise, rate, lowCut), (p) =>
    onProgress(p, `Corrigiendo afinación (${Math.round(cents)} cents)`),
  );
  return { raw, rate, cents };
}

export interface NotesOptions {
  mode: Mode;
  sensitivity: number; // 0.2..0.8
  offset?: number; // segundos a restar (alineación con YouTube)
  minMidi?: number; // nota más grave de la afinación (+ capo)
  clean?: Partial<CleanOptions>;
}

export function toNotes(p: Prepared, opts: NotesOptions): Note[] {
  const notes = extractNotes(p.raw, {
    onsetThreshold: 1 - opts.sensitivity,
    frameThreshold: 0.45 - opts.sensitivity * 0.3,
    melodiaTrick: opts.mode === 'chords',
  })
    .map((n) => ({ ...n, start: n.start * p.rate - (opts.offset ?? 0), duration: n.duration * p.rate }))
    .filter((n) => n.start >= 0);
  return cleanNotes(notes, { minMidi: opts.minMidi, ...opts.clean, mode: opts.mode });
}
