// Sintetizador sencillo tipo cuerda pulsada para escuchar la transcripción.
import { midiToFreq } from './theory';

export function pluck(ctx: AudioContext, out: AudioNode, midi: number, duration: number, velocity: number): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = midiToFreq(midi);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(midiToFreq(midi) * 6, t);
  filter.frequency.exponentialRampToValueAtTime(midiToFreq(midi) * 1.5, t + 0.3);
  const peak = 0.12 * (0.4 + velocity);
  const len = Math.min(Math.max(duration, 0.15), 3);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
  osc.connect(filter).connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + len + 0.5);
}

/** Genera un riff de demostración (Do mayor arpegiado + acordes) para probar sin subir nada. */
export async function renderDemo(): Promise<AudioBuffer> {
  const sr = 44100;
  const seq: [number, number[]][] = [];
  const arp = [48, 52, 55, 60, 64, 60, 55, 52, 45, 52, 57, 60, 64, 60, 57, 52];
  arp.forEach((m, i) => seq.push([i * 0.25, [m]]));
  [[43, 47, 50, 55, 59, 67], [48, 52, 55, 60, 64], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65]].forEach((c, i) =>
    seq.push([4 + i, c]),
  );
  const ctx = new OfflineAudioContext(1, sr * 9, sr);
  for (const [time, midis] of seq) {
    midis.forEach((m, k) => {
      const t = time + k * 0.012; // pequeño rasgueo
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(m);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25 / midis.length + 0.08, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  }
  return ctx.startRendering();
}
