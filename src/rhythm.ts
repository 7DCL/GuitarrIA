// Ritmo: pulso, tempo, compás, tonalidad y cuantización de las notas a una cuadrícula musical.
// La IA da notas en segundos; para escribir partitura hacen falta figuras (negra, corchea…) y compases.
import type { Event } from './fingering';

/** Resolución de la cuadrícula: ticks por negra (4 = semicorcheas). */
export const TPQ = 4;

export interface Rhythm {
  beats: number[]; // segundos de cada pulso (negra), rellenados hasta cubrir toda la canción
  bpm: number; // tempo medio en negras por minuto
  beatsPerBar: number; // 4 = 4/4, 3 = 3/4, 2 = 2/4, 6 = 6/8 (en corcheas: 3 negras con puntillo → 6 corcheas)
  beatUnit: 4 | 8;
  firstBar: number; // índice del pulso donde empieza el compás 1
  key: number; // armadura en quintas: -7 (7 bemoles) .. 7 (7 sostenidos)
  minor: boolean;
}

export interface QEvent {
  index: number; // posición en el array de eventos
  tick: number; // inicio en ticks desde el compás 1
  dur: number; // duración en ticks (≥ 1)
}

// ---------- Detección del pulso ----------
const FPS = 100; // resolución de la envolvente de ataques

/** Envolvente de ataques a partir de las notas detectadas: un pico suavizado por evento, más alto si suenan más notas. */
export function onsetEnvelope(events: Event[], length: number): Float32Array {
  const env = new Float32Array(Math.ceil(length * FPS) + 1);
  for (const ev of events) {
    const w = ev.notes.reduce((s, n) => s + Math.min(1, n.velocity), 0) ** 0.5;
    const c = Math.round(ev.start * FPS);
    for (let d = -3; d <= 3; d++) {
      const i = c + d;
      if (i >= 0 && i < env.length) env[i] += w * Math.exp(-(d * d) / 4);
    }
  }
  return env;
}

/** Periodo del pulso (en frames) por autocorrelación, con preferencia por tempos cercanos a 110 BPM. */
export function estimatePeriod(env: Float32Array): number {
  const minLag = Math.round((60 / 200) * FPS);
  const maxLag = Math.round((60 / 45) * FPS);
  let best = Math.round((60 / 100) * FPS);
  let bestScore = -Infinity;
  const ac: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    ac[lag] = s;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Suma también los múltiplos: el pulso real se repite a 2× y 4× su periodo.
    let s = ac[lag];
    if (2 * lag <= maxLag) s += 0.5 * ac[2 * lag];
    else if (ac[Math.round(lag / 2)] !== undefined) s += 0.25 * ac[Math.round(lag / 2)];
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    const score = s * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Interpolación parabólica para afinar el periodo.
  const a = ac[best - 1] ?? 0;
  const b = ac[best];
  const c = ac[best + 1] ?? 0;
  const den = a - 2 * b + c;
  return den < 0 ? best + (0.5 * (a - c)) / den : best;
}

/** Energía de ataques en una rejilla de periodo `period` (mejor fase) y a medio camino entre pulsos. */
function gridEnergy(env: Float32Array, period: number): { on: number; mid: number } {
  const at = (x: number) => {
    const i = Math.round(x);
    let m = 0;
    for (let d = -2; d <= 2; d++) m = Math.max(m, env[i + d] ?? 0);
    return m;
  };
  let best = { on: -1, mid: 0 };
  for (let ph = 0; ph < period; ph += 1) {
    let on = 0;
    let mid = 0;
    for (let x = ph; x < env.length; x += period) {
      on += at(x);
      mid += at(x + period / 2);
    }
    if (on > best.on) best = { on, mid };
  }
  return best;
}

/** Corrige errores de octava del tempo: si casi nada cae entre pulsos, el pulso real es el doble de lento. */
export function fixOctave(env: Float32Array, period: number): number {
  let p = period;
  for (let k = 0; k < 2; k++) {
    const slow = 2 * p;
    if ((60 * FPS) / slow < 50) break;
    const g = gridEnergy(env, slow);
    if (g.mid < g.on * 0.4) p = slow;
    else break;
  }
  return p;
}

/**
 * Seguimiento del pulso por programación dinámica (Ellis 2007): cada pulso cae en un ataque
 * y la distancia entre pulsos se parece al periodo. Tolera pequeños cambios de tempo.
 */
export function trackBeats(env: Float32Array, period: number, tightness = 100): number[] {
  const n = env.length;
  if (n < period * 2) return [];
  const mean = env.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(env.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let prev = Math.max(0, t - hi); prev <= t - lo; prev++) {
      const v = score[prev] - tightness * Math.log((t - prev) / period) ** 2;
      if (v > best) {
        best = v;
        arg = prev;
      }
    }
    const o = env[t] / sd;
    if (arg >= 0) {
      score[t] = o + best;
      back[t] = arg;
    } else score[t] = o;
  }
  // El último pulso: el mejor puntaje dentro del último periodo.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.unshift(t);
  return beats;
}

/** Rellena pulsos antes del primero y después del último con el periodo medio, hasta cubrir [0, length]. */
export function extendBeats(beats: number[], length: number, fallbackPeriod: number): number[] {
  const out = [...beats];
  const p = out.length >= 2 ? (out[out.length - 1] - out[0]) / (out.length - 1) : fallbackPeriod;
  if (!out.length) out.push(0);
  while (out[0] - p > -p * 0.5 && out[0] > 0.0001) out.unshift(out[0] - p);
  while (out[out.length - 1] < length + p) out.push(out[out.length - 1] + p);
  return out;
}

// ---------- Compás ----------
/**
 * Elige compás (3 o 4 pulsos) y dónde cae el primer tiempo. Los cambios de acorde y los ataques
 * fuertes suelen caer en el primer tiempo del compás.
 */
export function detectMeter(beats: number[], events: Event[], chordChanges: number[]): { beatsPerBar: number; phase: number } {
  const weight = new Float64Array(beats.length);
  const nearest = (t: number) => {
    let lo = 0;
    let hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= t) lo = mid;
      else hi = mid;
    }
    return Math.abs(beats[lo] - t) <= Math.abs(beats[hi] - t) ? lo : hi;
  };
  const tol = beats.length > 1 ? (beats[1] - beats[0]) * 0.25 : 0.1;
  for (const c of chordChanges) {
    const i = nearest(c);
    if (Math.abs(beats[i] - c) < tol) weight[i] += 2;
  }
  for (const ev of events) {
    const i = nearest(ev.start);
    if (Math.abs(beats[i] - ev.start) < tol) {
      // Notas graves y acordes llenos marcan el primer tiempo.
      const low = Math.min(...ev.notes.map((n) => n.midi));
      weight[i] += 0.15 * ev.notes.length + (low < 50 ? 0.4 : 0);
    }
  }
  let best = { beatsPerBar: 4, phase: 0, score: -Infinity };
  for (const m of [4, 3]) {
    for (let ph = 0; ph < m; ph++) {
      let on = 0;
      let all = 0;
      for (let i = 0; i < beats.length; i++) {
        all += weight[i];
        if ((i - ph) % m === 0) on += weight[i];
      }
      // Proporción de peso en los primeros tiempos, comparada con el azar (1/m); 4/4 es lo más común.
      const score = all ? (on / all) * m + (m === 4 ? 0.35 : 0) : m === 4 ? 1 : 0;
      if (score > best.score) best = { beatsPerBar: m, phase: ph, score };
    }
  }
  return { beatsPerBar: best.beatsPerBar, phase: best.phase };
}

// ---------- Tonalidad ----------
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Quintas de la armadura de cada tónica mayor (C=0, Db=-5, D=2…). */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / 12;
  const mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Tonalidad por perfiles de Krumhansl: devuelve la armadura (quintas) y si es menor. */
export function detectKey(notes: { midi: number; duration: number; velocity: number }[]): { key: number; minor: boolean; tonic: number } {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.midi % 12] += Math.min(n.duration, 2) * Math.min(1, n.velocity + 0.2);
  let best = { key: 0, minor: false, tonic: 0, r: -Infinity };
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => hist.map((_, i) => p[(i - t + 12) % 12]);
    const rMaj = corr(hist, rot(MAJOR_PROFILE));
    const rMin = corr(hist, rot(MINOR_PROFILE));
    if (rMaj > best.r) best = { key: MAJOR_FIFTHS[t], minor: false, tonic: t, r: rMaj };
    // Menor relativa: misma armadura que la mayor tres semitonos arriba.
    if (rMin > best.r) best = { key: MAJOR_FIFTHS[(t + 3) % 12], minor: true, tonic: t, r: rMin };
  }
  // Fa# mayor / Sol♭ mayor: preferir 6 bemoles a 6 sostenidos solo si ya era negativa (se queda en ±6).
  return { key: best.key, minor: best.minor, tonic: best.tonic };
}

// ---------- Análisis completo ----------
export function analyzeRhythm(
  events: Event[],
  chordChanges: number[] = [],
  notes: { midi: number; duration: number; velocity: number }[] = [],
): Rhythm {
  const length = events.length ? Math.max(...events.map((e) => e.end)) + 1 : 4;
  const env = onsetEnvelope(events, length);
  const period = events.length >= 4 ? fixOctave(env, estimatePeriod(env)) : FPS * 0.6;
  const raw = events.length >= 4 ? trackBeats(env, period).map((f) => f / FPS) : [];
  const beats = extendBeats(raw, length, period / FPS);
  const { beatsPerBar, phase } = detectMeter(beats, events, chordChanges);
  // El compás 1 es el último primer tiempo que no pasa del primer evento.
  const firstEvent = events.length ? events[0].start : 0;
  let firstBar = phase;
  while (beats[firstBar] > firstEvent + 0.05) {
    // Hace falta un compás antes (anacrusa): se añaden pulsos hacia atrás aunque caigan antes del segundo 0.
    while (firstBar - beatsPerBar < 0) {
      beats.unshift(2 * beats[0] - beats[1]);
      firstBar++;
    }
    firstBar -= beatsPerBar;
  }
  while (firstBar + beatsPerBar < beats.length && beats[firstBar + beatsPerBar] <= firstEvent + 0.05) firstBar += beatsPerBar;
  const k = detectKey(notes.length ? notes : events.flatMap((e) => e.notes));
  return { beats, bpm: bpmOf(beats), beatsPerBar, beatUnit: 4, firstBar, key: k.key, minor: k.minor };
}

export function bpmOf(beats: number[]): number {
  if (beats.length < 2) return 120;
  const span = beats[beats.length - 1] - beats[0];
  return Math.round(((60 * (beats.length - 1)) / span) * 10) / 10;
}

/** Pulsos uniformes para un tempo fijo, alineados con el primer tiempo actual (cuando el usuario corrige el BPM). */
export function withTempo(r: Rhythm, bpm: number, length: number, anchor?: number): Rhythm {
  const p = 60 / bpm;
  // Ancla: un primer tiempo de compás (el actual, o el que marca el usuario al pulsar el pulso).
  const start = anchor ?? r.beats[r.firstBar] ?? 0;
  const beats: number[] = [];
  let firstBar = 0;
  let t = start;
  while (t - p > -p * 0.5 && t > 0.0001) {
    t -= p;
    firstBar++;
  }
  for (; t < length + p; t += p) beats.push(t);
  return { ...r, beats, bpm: Math.round(bpm * 10) / 10, firstBar };
}

// ---------- Tiempo ↔ ticks ----------
/** Convierte segundos en ticks (desde el compás 1), interpolando entre pulsos. */
export function timeToTick(r: Rhythm, t: number): number {
  const b = r.beats;
  let i = 0;
  let hi = b.length - 2;
  while (i < hi) {
    const mid = (i + hi + 1) >> 1;
    if (b[mid] <= t) i = mid;
    else hi = mid - 1;
  }
  const span = b[i + 1] - b[i] || 0.5;
  return (i + (t - b[i]) / span - r.firstBar) * TPQ;
}

export function tickToTime(r: Rhythm, tick: number): number {
  const beat = tick / TPQ + r.firstBar;
  const b = r.beats;
  const i = Math.max(0, Math.min(b.length - 2, Math.floor(beat)));
  return b[i] + (beat - i) * (b[i + 1] - b[i]);
}

/** Ticks por compás (en 6/8 son 6 corcheas = 12 semicorcheas). */
export function barTicks(r: Rhythm): number {
  return r.beatUnit === 8 ? (r.beatsPerBar * TPQ) / 2 : r.beatsPerBar * TPQ;
}

/**
 * Cuantiza los eventos a la cuadrícula: el inicio al tick más cercano (sin repetir: dos eventos no
 * pueden caer en el mismo tick) y la duración hasta su final o hasta el siguiente evento.
 */
export function quantize(events: Event[], r: Rhythm, grid = 1): QEvent[] {
  const out: QEvent[] = [];
  let last = -Infinity;
  events.forEach((ev, index) => {
    let tick = Math.round(timeToTick(r, ev.start) / grid) * grid;
    if (tick <= last) tick = last + grid;
    tick = Math.max(0, tick);
    if (tick <= last) tick = last + grid;
    out.push({ index, tick, dur: 0 });
    last = tick;
  });
  out.forEach((q, i) => {
    const ev = events[q.index];
    const end = Math.max(q.tick + grid, Math.round(timeToTick(r, ev.end) / grid) * grid);
    const next = out[i + 1]?.tick ?? Infinity;
    // Un silencio de menos de un tiempo entre dos notas casi siempre es la nota sonando hasta la siguiente
    // (la guitarra sigue vibrando): se escribe ligado, que se lee mucho mejor.
    const target = next !== Infinity && next - end < TPQ ? next : Math.min(end, next);
    q.dur = Math.max(grid, target - q.tick);
  });
  return out;
}

// ---------- Figuras ----------
/** Duraciones escribibles en ticks (semicorchea..redonda, con puntillo). */
export const NOTE_VALUES: { ticks: number; type: string; dots: number }[] = [
  { ticks: 16, type: 'whole', dots: 0 },
  { ticks: 12, type: 'half', dots: 1 },
  { ticks: 8, type: 'half', dots: 0 },
  { ticks: 6, type: 'quarter', dots: 1 },
  { ticks: 4, type: 'quarter', dots: 0 },
  { ticks: 3, type: 'eighth', dots: 1 },
  { ticks: 2, type: 'eighth', dots: 0 },
  { ticks: 1, type: '16th', dots: 0 },
];

/**
 * Parte una duración en figuras escribibles sin cruzar la barra de compás.
 * Devuelve trozos {tick, ticks}; los que van seguidos dentro de una nota se ligan.
 */
export function splitDuration(tick: number, dur: number, bar: number): { tick: number; ticks: number }[] {
  const out: { tick: number; ticks: number }[] = [];
  let t = tick;
  let left = dur;
  while (left > 0) {
    const toBar = bar - (t % bar);
    const room = Math.min(left, toBar);
    // La figura más larga que cabe y que empieza alineada con su propio valor (más fácil de leer).
    const pos = t % bar;
    const v =
      NOTE_VALUES.find((nv) => nv.ticks <= room && pos % Math.min(nv.dots ? (nv.ticks * 2) / 3 : nv.ticks, 4) === 0) ??
      NOTE_VALUES[NOTE_VALUES.length - 1];
    out.push({ tick: t, ticks: v.ticks });
    t += v.ticks;
    left -= v.ticks;
  }
  return out;
}

export function valueOf(ticks: number) {
  return NOTE_VALUES.find((v) => v.ticks === ticks) ?? NOTE_VALUES[NOTE_VALUES.length - 1];
}

/** Nombre de la armadura para la interfaz. */
export function keyLabel(key: number, minor: boolean): string {
  const majors: Record<number, string> = {
    [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
  };
  const minors: Record<number, string> = {
    [-7]: 'Ab', [-6]: 'Eb', [-5]: 'Bb', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#',
  };
  return minor ? `${minors[key]}m` : majors[key];
}
