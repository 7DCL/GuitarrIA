// Afinador: micrófono → YIN → mediana + suavizado → nota, cents y cuerda objetivo.
import { lowpass, median, yin } from './pitch';

export interface TunerReading {
  freq: number;
  midi: number; // con decimales, relativo al La de referencia
  nearest: number; // nota MIDI más cercana
  cents: number; // desviación respecto a `nearest` (o a la cuerda objetivo)
  target: number | null; // MIDI de la cuerda objetivo, si hay cuerdas definidas
}

export interface TunerOptions {
  a4: number; // La de referencia (440 por defecto)
  strings: number[]; // MIDI de las cuerdas al aire de la afinación elegida
  lockedString: number | null; // índice de cuerda fija, o null para detectar automáticamente
  minHz: number;
}

/** Interpreta una frecuencia según la referencia y las cuerdas (función pura, testeable). */
export function interpret(freq: number, opts: TunerOptions): TunerReading {
  const midi = 69 + 12 * Math.log2(freq / opts.a4);
  const nearest = Math.round(midi);
  let target: number | null = null;
  if (opts.strings.length) {
    if (opts.lockedString !== null) target = opts.strings[opts.lockedString];
    else {
      // Cuerda cuya nota está más cerca (en semitonos) de lo que suena.
      target = opts.strings.reduce((best, s) => (Math.abs(s - midi) < Math.abs(best - midi) ? s : best), opts.strings[0]);
      if (Math.abs(target - midi) > 2.5) target = null; // lejos de cualquier cuerda: modo cromático
    }
  }
  const ref = target ?? nearest;
  return { freq, midi, nearest, cents: (midi - ref) * 100, target };
}

export class Tuner {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private timer = 0;
  private history: number[] = [];
  private smoothCents: number | null = null;
  private lastHeard = 0;
  opts: TunerOptions;

  constructor(ctx: AudioContext, opts: TunerOptions, private onReading: (r: TunerReading | null, level: number) => void) {
    this.ctx = ctx;
    this.opts = opts;
  }

  get running() {
    return this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    await this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 8192; // ventana larga: necesaria para las cuerdas graves (y el bajo)
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    const buf = new Float32Array(this.analyser.fftSize);
    // ~20 lecturas por segundo: suficiente para un afinador y no gasta batería.
    this.timer = window.setInterval(() => this.tick(buf), 50);
  }

  stop(): void {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.history = [];
    this.smoothCents = null;
    this.onReading(null, 0);
  }

  private tick(buf: Float32Array<ArrayBuffer>) {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(buf);
    let level = 0;
    for (let i = 0; i < buf.length; i += 4) level = Math.max(level, Math.abs(buf[i]));
    const r = yin(lowpass(buf, this.ctx.sampleRate, 1500), this.ctx.sampleRate, this.opts.minHz, 1400);
    const now = performance.now();
    if (!r || r.clarity < 0.75) {
      // Tras ~1 s sin nota clara, el afinador vuelve a reposo.
      if (now - this.lastHeard > 1000 && this.history.length) {
        this.history = [];
        this.smoothCents = null;
        this.onReading(null, level);
      }
      return;
    }
    this.lastHeard = now;
    // Mediana de las últimas 5 lecturas: descarta saltos sueltos (ataque de la púa, armónicos).
    if (this.history.length && Math.abs(1200 * Math.log2(r.freq / this.history[this.history.length - 1])) > 80) this.history = [];
    this.history.push(r.freq);
    if (this.history.length > 5) this.history.shift();
    const reading = interpret(median(this.history), this.opts);
    // Suavizado exponencial de la aguja (sin perder respuesta al cambiar de cuerda).
    this.smoothCents =
      this.smoothCents === null || Math.abs(reading.cents - this.smoothCents) > 30
        ? reading.cents
        : this.smoothCents * 0.6 + reading.cents * 0.4;
    this.onReading({ ...reading, cents: this.smoothCents }, level);
  }
}
