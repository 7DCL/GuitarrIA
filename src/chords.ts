// Reconocimiento de acordes a lo largo de la canción.
// En vez de mirar notas sueltas, suma la energía de cada nota por clase (cromagrama) en ventanas
// cortas, la compara con plantillas de acordes y suaviza con Viterbi para que no "parpadee".
import { NOTE_NAMES } from './theory';

export interface ChordSegment {
  start: number;
  end: number;
  name: string; // 'N' = sin acorde
  root: number; // 0..11, -1 si 'N'
  quality: string;
  bass: number; // clase de nota del bajo
}

interface Quality {
  suffix: string;
  tones: [number, number][]; // [intervalo, peso]
  prior: number; // los acordes comunes se prefieren ante la duda
}

export const QUALITIES: Quality[] = [
  { suffix: '', tones: [[0, 1], [4, 1], [7, 0.8]], prior: 0.06 },
  { suffix: 'm', tones: [[0, 1], [3, 1], [7, 0.8]], prior: 0.06 },
  { suffix: '7', tones: [[0, 1], [4, 1], [7, 0.7], [10, 0.9]], prior: 0.02 },
  { suffix: 'maj7', tones: [[0, 1], [4, 1], [7, 0.7], [11, 0.9]], prior: 0.01 },
  { suffix: 'm7', tones: [[0, 1], [3, 1], [7, 0.7], [10, 0.9]], prior: 0.02 },
  { suffix: 'sus2', tones: [[0, 1], [2, 1], [7, 0.8]], prior: 0 },
  { suffix: 'sus4', tones: [[0, 1], [5, 1], [7, 0.8]], prior: 0 },
  { suffix: 'dim', tones: [[0, 1], [3, 1], [6, 1]], prior: -0.01 },
  { suffix: 'aug', tones: [[0, 1], [4, 1], [8, 1]], prior: -0.02 },
  { suffix: '5', tones: [[0, 1], [7, 1]], prior: 0.01 },
  { suffix: 'm7b5', tones: [[0, 1], [3, 1], [6, 1], [10, 0.9]], prior: -0.02 },
  { suffix: 'dim7', tones: [[0, 1], [3, 1], [6, 1], [9, 1]], prior: -0.03 },
  { suffix: '6', tones: [[0, 1], [4, 1], [7, 0.7], [9, 0.9]], prior: -0.02 },
  { suffix: 'm6', tones: [[0, 1], [3, 1], [7, 0.7], [9, 0.9]], prior: -0.03 },
  { suffix: 'add9', tones: [[0, 1], [4, 1], [7, 0.7], [2, 0.8]], prior: -0.02 },
  { suffix: '7sus4', tones: [[0, 1], [5, 1], [7, 0.7], [10, 0.9]], prior: -0.02 },
  { suffix: '9', tones: [[0, 1], [4, 1], [7, 0.6], [10, 0.9], [2, 0.8]], prior: -0.03 },
];

const FPS = 22050 / 256; // frames por segundo de Basic Pitch
const HOP = 0.2; // segundos por ventana de análisis
let BASS_DOMINANCE = 2; // elegido con eval/
export const _setBassDominance = (v: number) => (BASS_DOMINANCE = v); // para eval/

interface Template {
  root: number;
  q: Quality;
  vec: Float64Array;
  name: string;
}

const TEMPLATES: Template[] = [];
for (let root = 0; root < 12; root++) {
  for (const q of QUALITIES) {
    const vec = new Float64Array(12);
    for (const [iv, w] of q.tones) vec[(root + iv) % 12] = w;
    normalize(vec);
    TEMPLATES.push({ root, q, vec, name: NOTE_NAMES[root] + q.suffix });
  }
}

function normalize(v: Float64Array): number {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return n;
}

export interface ChromaWindow {
  time: number;
  chroma: Float64Array; // normalizado
  energy: number;
  bass: number; // clase de la nota más grave con energía, -1 si ninguna
  bassSure: boolean; // el bajo destaca claramente (para escribir inversiones X/bajo)
}

/** Cromagrama por ventanas a partir de las activaciones por nota (frames × 88, MIDI 21..108). */
export function chromagram(frames: number[][], timeScale = 1, offset = 0, bassMemory = 0.8): ChromaWindow[] {
  const per = Math.max(1, Math.round(HOP * FPS));
  const out: ChromaWindow[] = [];
  // El bajo suena y se queda: se recuerda unos instantes (en arpegios la tónica suena solo al principio).
  const low = new Float64Array(12);
  for (let f0 = 0; f0 < frames.length; f0 += per) {
    const chroma = new Float64Array(12);
    const lowNow = new Float64Array(12);
    const f1 = Math.min(frames.length, f0 + per);
    for (let f = f0; f < f1; f++) {
      const row = frames[f];
      for (let k = 0; k < row.length; k++) {
        const v = row[k];
        if (v < 0.15) continue;
        const midi = k + 21;
        chroma[midi % 12] += v;
        if (midi < 60) lowNow[midi % 12] += v * (60 - midi); // cuanto más grave, más peso
      }
    }
    // Una nota grave nueva desplaza a la anterior, que se va apagando (más deprisa si ya no suena).
    // "Nueva" = tan grave y fuerte como el bajo actual (en un arpegio las notas de arriba no cuentan).
    const n = f1 - f0;
    const fresh = Math.max(...lowNow) / n >= Math.max(...low) * 1.0;
    for (let i = 0; i < 12; i++) {
      const keep = fresh && lowNow[i] === 0 ? bassMemory ** 3 : bassMemory;
      low[i] = Math.max(low[i] * keep, lowNow[i] / n);
    }
    let bass = -1;
    let best = 0;
    low.forEach((v, i) => {
      if (v > best) {
        best = v;
        bass = i;
      }
    });
    // Bajo dudoso (otra nota grave casi igual de fuerte): sirve para puntuar, no para escribir X/bajo.
    const second = Math.max(...Array.from(low).filter((_, i) => i !== bass));
    const bassSure = best >= second * BASS_DOMINANCE;
    const energy = normalize(chroma) / (f1 - f0);
    out.push({ time: (f0 / FPS) * timeScale - offset, chroma, energy, bass, bassSure });
  }
  return out;
}

export interface ChordOptions {
  timeScale?: number; // corrección de afinación (los tiempos se multiplican por ella)
  offset?: number; // segundos a restar (alineación con YouTube)
  changePenalty?: number; // más alto = menos cambios de acorde
  smoothing?: number; // 0..1: memoria del cromagrama (ayuda con arpegios)
  priorScale?: number; // cuánto se prefieren los acordes comunes
  bassWeight?: number; // cuánto pesa la nota del bajo
  bassMemory?: number; // 0..1: cuánto se recuerda el bajo entre ventanas
}

/** Puntuación de cada plantilla (más alto = mejor) para una ventana. */
function scores(w: ChromaWindow, o: Required<ChordOptions>): number[] {
  return TEMPLATES.map((t) => {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += t.vec[i] * w.chroma[i];
    // El bajo en la tónica refuerza el acorde (ayuda a distinguir Am de C6, Em de G6…).
    const bassBonus = w.bass === t.root ? 1 : t.q.tones.some(([iv]) => (t.root + iv) % 12 === w.bass) ? 0.25 : -0.5;
    // Un "5" (quinta sola) no lleva tercera: si la tercera suena, es mayor o menor (Em abierto tiene un solo Sol).
    const third = t.q.suffix === '5' ? Math.max(w.chroma[(t.root + 3) % 12], w.chroma[(t.root + 4) % 12]) : 0;
    return dot + t.q.prior * o.priorScale + bassBonus * o.bassWeight - third * 0.5;
  });
}

/** Detecta los acordes de toda la canción. */
export function detectChords(frames: number[][], options: ChordOptions = {}): ChordSegment[] {
  const o: Required<ChordOptions> = {
    timeScale: 1,
    offset: 0,
    // Valores elegidos con eval/ (scripts/eval.cjs, casos acordes_*).
    changePenalty: 0.35,
    smoothing: 0.5,
    priorScale: 0.3,
    bassWeight: 0.08,
    bassMemory: 0.8,
    ...options,
  };
  const { timeScale, changePenalty } = o;
  const wins = chromagram(frames, timeScale, o.offset, o.bassMemory);
  if (o.smoothing > 0) {
    // Integrador con fuga: cada ventana recuerda parte de las anteriores.
    const acc = new Float64Array(12);
    for (const w of wins) {
      for (let i = 0; i < 12; i++) acc[i] = acc[i] * o.smoothing + w.chroma[i] * w.energy;
      w.chroma = Float64Array.from(acc);
      normalize(w.chroma);
    }
  }
  if (!wins.length) return [];
  const maxEnergy = Math.max(...wins.map((w) => w.energy));
  const nT = TEMPLATES.length;
  const N = nT; // índice del estado 'sin acorde'
  const silence = (w: ChromaWindow) => w.energy < maxEnergy * 0.08;

  // Viterbi: cambiar de acorde cuesta `changePenalty`; quedarse es gratis.
  let prev = new Float64Array(nT + 1);
  const back: Int32Array[] = [];
  wins.forEach((w, i) => {
    const s = silence(w) ? new Array(nT).fill(-1) : scores(w, o);
    const sN = silence(w) ? 1 : 0.35; // 'N' gana solo si apenas suena nada
    const cur = new Float64Array(nT + 1);
    const bp = new Int32Array(nT + 1);
    let bestPrev = 0;
    for (let j = 1; j <= nT; j++) if (prev[j] > prev[bestPrev]) bestPrev = j;
    for (let j = 0; j <= nT; j++) {
      const stay = prev[j];
      const move = prev[bestPrev] - changePenalty;
      const from = i === 0 || stay >= move ? j : bestPrev;
      cur[j] = (i === 0 ? 0 : Math.max(stay, move)) + (j === N ? sN : s[j]);
      bp[j] = from;
    }
    back.push(bp);
    prev = cur;
  });

  let state = 0;
  for (let j = 1; j <= nT; j++) if (prev[j] > prev[state]) state = j;
  const path = new Array<number>(wins.length);
  for (let i = wins.length - 1; i >= 0; i--) {
    path[i] = state;
    state = back[i][state];
  }

  // Bajo suavizado (moda en ±2 ventanas) para no reaccionar a notas de paso.
  const bass = wins.map((_, i) => {
    const count = new Map<number, number>();
    for (let k = Math.max(0, i - 2); k <= Math.min(wins.length - 1, i + 2); k++)
      if (wins[k].bass >= 0 && wins[k].bassSure) count.set(wins[k].bass, (count.get(wins[k].bass) ?? 0) + 1);
    let best = -1;
    let n = 0;
    count.forEach((v, key) => {
      if (v > n) {
        n = v;
        best = key;
      }
    });
    return best;
  });

  // Agrupar ventanas con el mismo acorde y el mismo bajo (así C y C/E quedan separados).
  const segs: ChordSegment[] = [];
  path.forEach((st, i) => {
    const w = wins[i];
    const end = w.time + HOP * timeScale;
    const t = st === N ? null : TEMPLATES[st];
    const chordBass = t && t.q.tones.some(([iv]) => (t.root + iv) % 12 === bass[i]) ? bass[i] : (t?.root ?? -1);
    const last = segs[segs.length - 1];
    if (last && sameState(last, st) && last.bass === chordBass) {
      last.end = end;
      return;
    }
    segs.push(
      t
        ? { start: w.time, end, name: t.name, root: t.root, quality: t.q.suffix, bass: chordBass }
        : { start: w.time, end, name: 'N', root: -1, quality: '', bass: -1 },
    );
  });

  // Tramos de bajo muy cortos se funden con el anterior del mismo acorde.
  const merged: ChordSegment[] = [];
  for (const sg of segs) {
    const last = merged[merged.length - 1];
    if (last && last.root === sg.root && last.quality === sg.quality && (sg.end - sg.start < 0.5 || last.end - last.start < 0.5)) {
      if (sg.end - sg.start > last.end - last.start) last.bass = sg.bass;
      last.end = sg.end;
    } else merged.push({ ...sg });
  }
  for (const sg of merged)
    if (sg.root >= 0 && sg.bass !== sg.root) sg.name = `${NOTE_NAMES[sg.root]}${sg.quality}/${NOTE_NAMES[sg.bass]}`;
  return merged.filter((sg) => sg.end > 0).map((sg) => ({ ...sg, start: Math.max(0, sg.start) }));
}

function sameState(seg: ChordSegment, st: number): boolean {
  if (st === TEMPLATES.length) return seg.root === -1;
  const t = TEMPLATES[st];
  return seg.root === t.root && seg.quality === t.q.suffix;
}

export function chordAt(segs: ChordSegment[], t: number): ChordSegment | null {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].end <= t) lo = mid + 1;
    else if (segs[mid].start > t) hi = mid - 1;
    else return segs[mid];
  }
  return null;
}

/** Activaciones aproximadas a partir de notas ya transcritas (proyectos importados sin audio). */
export function framesFromNotes(notes: { start: number; duration: number; midi: number; velocity: number }[]): number[][] {
  const end = Math.max(0, ...notes.map((n) => n.start + n.duration));
  const frames = Array.from({ length: Math.ceil(end * FPS) + 1 }, () => new Array<number>(88).fill(0));
  for (const n of notes) {
    const k = n.midi - 21;
    if (k < 0 || k >= 88) continue;
    const v = Math.min(1, 0.5 + n.velocity * 0.5);
    for (let f = Math.floor(n.start * FPS); f < Math.ceil((n.start + n.duration) * FPS) && f < frames.length; f++)
      frames[f][k] = Math.max(frames[f][k], v);
  }
  return frames;
}
