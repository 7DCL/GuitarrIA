// Limpieza de la transcripción: quita notas fantasma que la IA oye en mezclas reales
// (armónicos, bajo, otros instrumentos, re-ataques de una misma nota).
import type { Note } from './fingering';

export type Mode = 'lead' | 'chords';

export interface CleanOptions {
  mode: Mode;
  minVelocity?: number; // relativo a la nota más fuerte (0..1)
  minDuration?: number; // segundos
  minMidi?: number;
  maxMidi?: number;
  merge?: boolean; // unir re-ataques falsos (apagado por defecto: en pruebas borraba notas repetidas reales)
  harmonics?: boolean; // quitar armónicos (solo punteo)
}

const HARMONICS = new Set([12, 19, 24]); // 2º, 3º y 4º armónico

/** Quita una nota que es armónico (octava, quinta+octava…) de otra más fuerte que suena a la vez. */
function dropHarmonics(notes: Note[]): Note[] {
  return notes.filter(
    (n) =>
      !notes.some(
        (m) =>
          m !== n && HARMONICS.has(n.midi - m.midi) && Math.abs(m.start - n.start) < 0.08 && m.velocity >= n.velocity * 1.25,
      ),
  );
}

/** Une re-ataques falsos: la misma altura que vuelve a empezar justo al terminar la anterior. */
function mergeRepeats(notes: Note[]): Note[] {
  const out: Note[] = [];
  const lastByPitch = new Map<number, Note>();
  for (const n of notes) {
    const prev = lastByPitch.get(n.midi);
    if (prev && n.start - (prev.start + prev.duration) < 0.03 && n.velocity <= prev.velocity * 1.2) {
      prev.duration = Math.max(prev.duration, n.start + n.duration - prev.start);
      continue;
    }
    const copy = { ...n };
    out.push(copy);
    lastByPitch.set(n.midi, copy);
  }
  return out;
}

/** Deja una sola nota a la vez, siguiendo la línea melódica. */
function monophonic(notes: Note[]): Note[] {
  const out: Note[] = [];
  let pending: Note[][] = []; // grupos graves seguidos sin melodía en medio
  let i = 0;
  while (i < notes.length) {
    const group = [notes[i]];
    while (i + group.length < notes.length && notes[i + group.length].start - notes[i].start < 0.06)
      group.push(notes[i + group.length]);
    i += group.length;
    const t = group[0].start;
    let prev = out[out.length - 1];
    // Registro de la melodía reciente (último segundo y medio). Muy por debajo = acompañamiento,
    // salvo que la melodía lleve un rato sin aparecer: entonces es que la frase bajó de verdad.
    const recent = out.filter((n) => t - n.start < 1.5).map((n) => n.midi).sort((a, b) => a - b);
    const median = recent.length >= 3 ? recent[recent.length >> 1] : -Infinity;
    let pool = group.filter((n) => n.midi >= median - 10);
    if (!pool.length) {
      pending.push(group);
      // Tres grupos graves seguidos sin melodía: la frase bajó de verdad; se recuperan.
      if (pending.length < 3) continue;
      const back = pending.slice(0, -1);
      pending = [];
      for (const g of back) out.push({ ...g.sort((a, b) => b.velocity - a.velocity)[0] });
      prev = out[out.length - 1];
      pool = group;
    } else {
      // Si la melodía sigue justo donde iban esos graves, eran parte de la frase.
      const last = pending[pending.length - 1];
      if (last && pool.some((n) => last.some((m) => Math.abs(m.midi - n.midi) <= 7))) {
        for (const g of pending) out.push({ ...g.sort((a, b) => b.velocity - a.velocity)[0] });
        prev = out[out.length - 1];
      }
      pending = [];
    }
    // Una nota que ya sonaba y "vuelve a empezar" justo cuando entra otra es un eco del modelo.
    const ringing = (n: Note) => prev && n.midi === prev.midi && prev.start + prev.duration > n.start;
    const fresh = pool.filter((n) => !ringing(n));
    if (fresh.length) pool = fresh;
    const loud = Math.max(...pool.map((x) => x.velocity));
    const strong = pool.filter((n) => n.velocity >= loud * 0.6);
    // Sin contexto, la más aguda; con melodía en curso, la que menos salta (más aguda si empatan).
    const pick = strong.sort((a, b) =>
      prev ? Math.abs(a.midi - prev.midi) - Math.abs(b.midi - prev.midi) || b.midi - a.midi : b.midi - a.midi,
    )[0];
    // La nota anterior se corta donde empieza la nueva.
    if (prev && prev.start + prev.duration > pick.start) prev.duration = pick.start - prev.start;
    out.push({ ...pick });
  }
  return out;
}

export function cleanNotes(notes: Note[], opts: CleanOptions): Note[] {
  const lead = opts.mode === 'lead';
  const minVel = opts.minVelocity ?? (lead ? 0.3 : 0.2);
  const minDur = opts.minDuration ?? (lead ? 0.07 : 0.05);
  const lo = opts.minMidi ?? 28; // quien llama pasa la nota más grave de la afinación elegida
  const hi = opts.maxMidi ?? 88;
  const max = Math.max(0, ...notes.map((n) => n.velocity));
  let out = [...notes]
    .sort((a, b) => a.start - b.start || a.midi - b.midi)
    .filter((n) => n.midi >= lo && n.midi <= hi && n.duration >= minDur && n.velocity >= max * minVel);
  // En acordes las octavas suelen ser reales (cejillas, power chords): solo se filtran en punteo.
  if (lead && opts.harmonics !== false) out = dropHarmonics(out);
  if (opts.merge) out = mergeRepeats(out);
  if (lead) out = monophonic(out);
  return out;
}
