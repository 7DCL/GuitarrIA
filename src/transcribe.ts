// Transcripción audio → notas con Basic Pitch (Spotify), ejecutado en el navegador.
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { Note } from './fingering';

const MODEL_SR = 22050;
let model: BasicPitch | null = null;

export interface TranscribeOptions {
  onsetThreshold?: number; // más bajo = más notas
  frameThreshold?: number;
  minNoteMs?: number;
  minMidi?: number;
  maxMidi?: number;
}

/** Mezcla a mono y remuestrea a 22.05 kHz, que es lo que espera el modelo. */
export async function toModelInput(buffer: AudioBuffer): Promise<AudioBuffer> {
  const length = Math.ceil(buffer.duration * MODEL_SR);
  const ctx = new OfflineAudioContext(1, length, MODEL_SR);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

export interface RawOutput {
  frames: number[][];
  onsets: number[][];
  contours: number[][];
}

/** Ejecuta la red neuronal. Es la parte lenta: guarda el resultado para re-ajustar sin repetirla. */
export async function runModel(buffer: AudioBuffer, onProgress: (pct: number) => void): Promise<RawOutput> {
  model ??= new BasicPitch(`${import.meta.env.BASE_URL}model/model.json`);
  const input = await toModelInput(buffer);
  const raw: RawOutput = { frames: [], onsets: [], contours: [] };
  await model.evaluateModel(
    input,
    (f, o, c) => {
      raw.frames.push(...f);
      raw.onsets.push(...o);
      raw.contours.push(...c);
    },
    onProgress,
  );
  return raw;
}

/** Convierte la salida del modelo en notas. Rápido: se puede repetir al mover la sensibilidad. */
export function extractNotes(raw: RawOutput, opts: TranscribeOptions = {}): Note[] {
  // Basic Pitch cuenta la duración mínima en frames (~11.6 ms cada uno).
  const minFrames = Math.round((opts.minNoteMs ?? 60) / 11.6);
  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(
      raw.contours,
      outputToNotesPoly(raw.frames, raw.onsets, opts.onsetThreshold ?? 0.5, opts.frameThreshold ?? 0.3, minFrames),
    ),
  );
  const lo = opts.minMidi ?? 28;
  const hi = opts.maxMidi ?? 88;
  return events
    .filter((e) => e.pitchMidi >= lo && e.pitchMidi <= hi)
    .map((e) => ({ start: e.startTimeSeconds, duration: e.durationSeconds, midi: e.pitchMidi, velocity: e.amplitude }))
    .sort((a, b) => a.start - b.start);
}
