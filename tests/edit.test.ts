import { describe, expect, it } from 'vitest';
import { deleteEvent, History, insertAfter, moveEvent, notesFromEvents, setDuration, setFret } from '../src/edit';
import type { Event } from '../src/fingering';
import { quantize, withTempo, analyzeRhythm, type Rhythm } from '../src/rhythm';

const TUNING = [40, 45, 50, 55, 59, 64];
// Cuatro negras a 60 BPM (1 s por tiempo) empezando en 0: compás de 4/4 exacto.
function setup(): { ev: Event[]; r: Rhythm } {
  const ev: Event[] = [0, 1, 2, 3].map((t) => ({ start: t, end: t + 0.9, notes: [{ start: t, duration: 0.9, midi: 55 + t, velocity: 0.7, string: 3, fret: t }] }));
  const r = withTempo({ ...analyzeRhythm(ev), firstBar: 0, beats: [0, 1] }, 60, 6);
  return { ev, r };
}

describe('editor', () => {
  it('cambia y quita trastes, y recalcula la altura', () => {
    const { ev } = setup();
    let out = setFret(ev, 0, 5, 3, TUNING, 0);
    expect(out[0].notes.map((n) => [n.string, n.fret, n.midi])).toEqual([[3, 0, 55], [5, 3, 67]]);
    out = setFret(out, 0, 3, null, TUNING, 0);
    expect(out[0].notes.length).toBe(1);
    expect(ev[0].notes.length).toBe(1); // el original no cambia (para deshacer)
    // Con capo 2 el traste 0 suena dos semitonos más alto.
    expect(setFret(ev, 1, 0, 0, TUNING, 2)[1].notes.find((n) => n.string === 0)!.midi).toBe(42);
    // Sin notas, el evento desaparece.
    expect(setFret(ev, 2, 3, null, TUNING, 0).length).toBe(3);
  });

  it('duración, mover e insertar respetan la cuadrícula y a los vecinos', () => {
    const { ev, r } = setup();
    const q = quantize(ev, r);
    expect(q.map((x) => x.tick)).toEqual([0, 4, 8, 12]);
    const shorter = setDuration(ev, q, r, 0, 2);
    expect(quantize(shorter, r)[0].dur).toBe(2);
    const moved = moveEvent(ev, q, r, 1, 1);
    expect(quantize(moved, r)[1].tick).toBe(5);
    // No puede saltar por encima del siguiente.
    expect(quantize(moveEvent(ev, q, r, 1, 10), r)[1].tick).toBe(7);
    const ins = insertAfter(ev, q, r, 0);
    expect(ins.index).toBe(1);
    expect(quantize(ins.events, r).map((x) => x.tick)).toEqual([0, 2, 4, 8, 12]);
    expect(deleteEvent(ev, 0).length).toBe(3);
    expect(notesFromEvents(ev).length).toBe(4);
  });

  it('deshacer y rehacer', () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(null);
    expect(h.redo(1)).toBe(2);
    h.push(5);
    expect(h.canRedo).toBe(false);
  });
});
