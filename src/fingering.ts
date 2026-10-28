// Asigna a cada nota una cuerda y un traste tocables.
// Una misma altura se puede tocar en varios sitios del diapasón; elegimos la
// secuencia que minimiza saltos de mano y aperturas imposibles (Viterbi).

export interface Note {
  start: number; // segundos
  duration: number;
  midi: number;
  velocity: number; // 0..1
}

export interface Position {
  string: number; // 0 = cuerda más grave
  fret: number; // relativo al capo
}

export interface PlacedNote extends Note, Position {}

export interface Event {
  start: number;
  end: number;
  notes: PlacedNote[];
}

export interface FingeringOptions {
  tuning: number[]; // MIDI al aire, de grave a aguda
  capo?: number;
  maxFret?: number;
  chordWindow?: number; // segundos para agrupar notas en un acorde
  maxSpan?: number; // trastes que abarca la mano
}

const BEAM = 60;

/** Agrupa notas que empiezan casi a la vez en un mismo evento (acorde/rasgueo). */
export function groupNotes(notes: Note[], window = 0.05): Note[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const groups: Note[][] = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    if (last && n.start - last[0].start <= window) last.push(n);
    else groups.push([n]);
  }
  return groups;
}

function positionsFor(midi: number, tuning: number[], capo: number, maxFret: number): Position[] {
  const out: Position[] = [];
  tuning.forEach((open, string) => {
    const fret = midi - open - capo;
    if (fret >= 0 && fret <= maxFret) out.push({ string, fret });
  });
  return out;
}

interface Candidate {
  positions: Position[];
  notes: Note[];
  hand: number; // traste donde se apoya el índice
  cost: number; // coste propio de la digitación
}

/** Todas las digitaciones razonables de un grupo de notas (cuerdas distintas, apertura limitada). */
function candidatesFor(group: Note[], opts: Required<FingeringOptions>): Candidate[] {
  const { tuning, capo, maxFret, maxSpan } = opts;
  // Quitar duplicados de altura y quedarse con las más fuertes si hay más notas que cuerdas.
  const unique = new Map<number, Note>();
  for (const n of group) if (!unique.has(n.midi) || unique.get(n.midi)!.velocity < n.velocity) unique.set(n.midi, n);
  let notes = [...unique.values()].sort((a, b) => b.velocity - a.velocity).slice(0, tuning.length);

  while (notes.length > 0) {
    const options = notes.map((n) => positionsFor(n.midi, tuning, capo, maxFret));
    const playable = notes.filter((_, i) => options[i].length > 0);
    if (playable.length !== notes.length) {
      notes = playable;
      continue;
    }
    const result: Candidate[] = [];
    const chosen: Position[] = [];
    const used = new Set<number>();
    const walk = (i: number) => {
      if (result.length > 400) return;
      if (i === notes.length) {
        const fretted = chosen.map((p) => p.fret).filter((f) => f > 0);
        const lo = fretted.length ? Math.min(...fretted) : 0;
        const hi = fretted.length ? Math.max(...fretted) : 0;
        if (hi - lo > maxSpan) return;
        const avg = chosen.reduce((s, p) => s + p.fret, 0) / chosen.length;
        // Penaliza abrir mucho la mano y subir mucho por el mástil; premia cuerdas al aire.
        const cost = (hi - lo) * 0.6 + avg * 0.2 - chosen.filter((p) => p.fret === 0).length * 0.1;
        result.push({ positions: [...chosen], notes, hand: lo, cost });
        return;
      }
      for (const p of options[i]) {
        if (used.has(p.string)) continue;
        used.add(p.string);
        chosen.push(p);
        walk(i + 1);
        chosen.pop();
        used.delete(p.string);
      }
    };
    walk(0);
    if (result.length) return result.sort((a, b) => a.cost - b.cost).slice(0, BEAM);
    notes = notes.slice(0, -1); // descartar la nota más débil y reintentar
  }
  return [];
}

function transition(prev: Candidate, next: Candidate, gap: number): number {
  // Las cuerdas al aire no obligan a mover la mano.
  if (next.positions.every((p) => p.fret === 0) || prev.positions.every((p) => p.fret === 0)) return 0;
  const move = Math.abs(next.hand - prev.hand);
  // Con más tiempo entre notas, un salto cuesta menos.
  return move * (gap < 0.3 ? 1 : 0.5);
}

export function assignFingering(notes: Note[], options: FingeringOptions): Event[] {
  const opts: Required<FingeringOptions> = {
    capo: 0,
    maxFret: 22,
    chordWindow: 0.05,
    maxSpan: 4,
    ...options,
  };
  const groups = groupNotes(notes, opts.chordWindow);
  const layers = groups.map((g) => candidatesFor(g, opts)).filter((c) => c.length > 0);
  if (!layers.length) return [];

  // Viterbi: coste acumulado mínimo por candidato de cada capa.
  let costs = layers[0].map((c) => c.cost);
  const back: number[][] = [layers[0].map(() => -1)];
  for (let i = 1; i < layers.length; i++) {
    const gap = layers[i][0].notes[0].start - layers[i - 1][0].notes[0].start;
    const nextCosts: number[] = [];
    const nextBack: number[] = [];
    for (const cand of layers[i]) {
      let best = Infinity;
      let arg = 0;
      layers[i - 1].forEach((prev, j) => {
        const c = costs[j] + transition(prev, cand, gap);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      nextCosts.push(best + cand.cost);
      nextBack.push(arg);
    }
    costs = nextCosts;
    back.push(nextBack);
  }

  let k = costs.indexOf(Math.min(...costs));
  const picked: Candidate[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    picked.unshift(layers[i][k]);
    k = back[i][k];
  }

  return picked.map((cand) => {
    const placed = cand.notes.map((n, i) => ({ ...n, ...cand.positions[i] }));
    const start = Math.min(...placed.map((n) => n.start));
    const end = Math.max(...placed.map((n) => n.start + n.duration));
    return { start, end, notes: placed.sort((a, b) => a.string - b.string) };
  });
}
