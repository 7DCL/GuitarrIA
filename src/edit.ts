// Edición de la transcripción: cada operación devuelve una lista nueva de eventos (la anterior
// queda intacta para poder deshacer). Los tiempos se guardan en segundos para seguir sincronizados
// con el audio; la cuadrícula (ticks) solo decide a dónde se mueve o cuánto dura cada nota.
import type { Event, Note, PlacedNote } from './fingering';
import { tickToTime, type QEvent, type Rhythm } from './rhythm';

export const cloneEvents = (events: Event[]): Event[] => events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n })) }));

/** Notas sueltas (para MIDI, acordes y proyecto) a partir de los eventos. */
export function notesFromEvents(events: Event[]): Note[] {
  return events.flatMap((e) => e.notes.map(({ start, duration, midi, velocity }) => ({ start, duration, midi, velocity })));
}

function withTimes(ev: Event, start: number, end: number): Event {
  return { start, end, notes: ev.notes.map((n) => ({ ...n, start, duration: end - start })) };
}

/** Pone (o quita, con `fret = null`) la nota de una cuerda en un evento. */
export function setFret(events: Event[], i: number, string: number, fret: number | null, tuning: number[], capo: number): Event[] {
  const out = cloneEvents(events);
  const ev = out[i];
  if (!ev) return out;
  const notes = ev.notes.filter((n) => n.string !== string);
  if (fret !== null && Number.isFinite(fret) && fret >= 0) {
    const vel = ev.notes.length ? Math.max(...ev.notes.map((n) => n.velocity)) : 0.8;
    const n: PlacedNote = { start: ev.start, duration: ev.end - ev.start, midi: tuning[string] + capo + fret, velocity: vel, string, fret };
    notes.push(n);
  }
  ev.notes = notes.sort((a, b) => a.string - b.string);
  // Un evento sin notas desaparece (queda un silencio).
  return ev.notes.length ? out : out.filter((_, k) => k !== i);
}

/** Cambia la duración en ticks (no puede pisar al siguiente evento). */
export function setDuration(events: Event[], q: QEvent[], r: Rhythm, i: number, ticks: number): Event[] {
  const out = cloneEvents(events);
  const qi = q.find((x) => x.index === i);
  if (!qi) return out;
  const next = q.find((x) => x.index === i + 1);
  const endTick = Math.min(qi.tick + ticks, next ? next.tick : Infinity);
  out[i] = withTimes(out[i], out[i].start, tickToTime(r, endTick) - 0.001);
  return out;
}

/** Mueve un evento `delta` ticks, sin cruzarse con sus vecinos. */
export function moveEvent(events: Event[], q: QEvent[], r: Rhythm, i: number, delta: number): Event[] {
  const out = cloneEvents(events);
  const pos = q.findIndex((x) => x.index === i);
  if (pos < 0) return out;
  const prev = q[pos - 1];
  const next = q[pos + 1];
  const cur = q[pos];
  const tick = Math.max(prev ? prev.tick + 1 : 0, Math.min(next ? next.tick - 1 : Infinity, cur.tick + delta));
  if (tick === cur.tick) return out;
  const start = tickToTime(r, tick);
  const end = tickToTime(r, tick + cur.dur) - 0.001;
  out[i] = withTimes(out[i], start, end);
  return out;
}

/** Inserta una copia del evento justo después (en el hueco libre, o partiendo su duración). Devuelve el índice nuevo. */
export function insertAfter(events: Event[], q: QEvent[], r: Rhythm, i: number): { events: Event[]; index: number } {
  const out = cloneEvents(events);
  const pos = q.findIndex((x) => x.index === i);
  if (pos < 0) return { events: out, index: i };
  const cur = q[pos];
  const next = q[pos + 1];
  let tick = cur.tick + cur.dur;
  let dur = cur.dur;
  if (next && tick >= next.tick) {
    // Sin hueco: la nota actual se acorta a la mitad y la nueva ocupa la otra mitad.
    if (cur.dur < 2) return { events: out, index: i };
    const half = Math.floor(cur.dur / 2);
    out[i] = withTimes(out[i], out[i].start, tickToTime(r, cur.tick + half) - 0.001);
    tick = cur.tick + half;
    dur = cur.dur - half;
  } else if (next) dur = Math.min(dur, next.tick - tick);
  const ev = withTimes(out[i], tickToTime(r, tick), tickToTime(r, tick + dur) - 0.001);
  out.splice(i + 1, 0, ev);
  return { events: out, index: i + 1 };
}

export function deleteEvent(events: Event[], i: number): Event[] {
  return cloneEvents(events).filter((_, k) => k !== i);
}

/** Historial para deshacer/rehacer. */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  constructor(private limit = 200) {}
  push(snapshot: T) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current: T): T | null {
    const s = this.undoStack.pop();
    if (s === undefined) return null;
    this.redoStack.push(current);
    return s;
  }
  redo(current: T): T | null {
    const s = this.redoStack.pop();
    if (s === undefined) return null;
    this.undoStack.push(current);
    return s;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
