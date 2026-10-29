// Busca una digitación tocable para un acorde (para el diagrama del acorde actual).
import { QUALITIES } from './chords';

export interface Voicing {
  frets: number[]; // por cuerda (grave → aguda); -1 = no se toca
  base: number; // primer traste que muestra el diagrama
}

const cache = new Map<string, Voicing | null>();

export function findVoicing(root: number, quality: string, bass: number, tuning: number[]): Voicing | null {
  const key = `${root}|${quality}|${bass}|${tuning.join(',')}`;
  if (cache.has(key)) return cache.get(key)!;
  const q = QUALITIES.find((x) => x.suffix === quality);
  if (!q || tuning.length < 6) return null;
  const tones = new Set(q.tones.map(([iv]) => (root + iv) % 12));
  // Notas imprescindibles: tónica, la que define el tipo (3ª o sus) y la 7ª si la hay.
  const required = q.tones.filter(([iv]) => iv !== 7).map(([iv]) => (root + iv) % 12);
  const n = tuning.length;
  let best: { frets: number[]; cost: number } | null = null;

  for (let pos = 0; pos <= 10; pos++) {
    const options = tuning.map((open) => {
      const opts: number[] = [-1];
      if (tones.has(open % 12)) opts.push(0);
      for (let f = Math.max(1, pos); f <= pos + 3; f++) if (tones.has((open + f) % 12)) opts.push(f);
      return opts;
    });
    const frets = new Array<number>(n).fill(-1);
    const walk = (s: number) => {
      if (s === n) {
        const sounding = frets.map((f, i) => (f < 0 ? -1 : tuning[i] + f)).filter((m) => m >= 0);
        if (sounding.length < 4) return;
        const first = frets.findIndex((f) => f >= 0);
        const last = n - 1 - [...frets].reverse().findIndex((f) => f >= 0);
        // Las cuerdas que suenan forman un bloque seguido (sin cuerdas apagadas en medio).
        if (frets.slice(first, last + 1).some((f) => f < 0)) return;
        if ((tuning[first] + frets[first]) % 12 !== bass) return;
        const pcs = new Set(sounding.map((m) => m % 12));
        if (!required.every((r) => pcs.has(r))) return;
        const fretted = frets.filter((f) => f > 0);
        const lo = fretted.length ? Math.min(...fretted) : 0;
        const hi = fretted.length ? Math.max(...fretted) : 0;
        if (hi - lo > 3) return;
        // ¿Hacen falta más de 4 dedos? Con cejilla, el traste más bajo cuenta como un dedo.
        const barre = fretted.filter((f) => f === lo).length > 1 && frets.slice(frets.indexOf(lo)).every((f) => f >= lo);
        const fingers = barre ? fretted.filter((f) => f > lo).length + 1 : fretted.length;
        if (fingers > 4) return;
        // Cuerdas al aire mezcladas con trastes altos: incómodo y poco habitual.
        const openHigh = hi >= 4 && frets.includes(0) ? 2 : 0;
        const mutedHigh = (n - 1 - last) * 1.2; // apagar agudas es menos natural que apagar graves
        const shape = isCagedShape(frets, tuning) ? -1.5 : 0; // las formas de cejilla de toda la vida
        const cost = shape + openHigh + mutedHigh + lo * 0.6 + (hi - lo) * 0.5 + fingers * 0.3 + (barre ? 1 : 0) - sounding.length * 0.4 - frets.filter((f) => f === 0).length * 0.15;
        if (!best || cost < best.cost) best = { frets: [...frets], cost };
        return;
      }
      for (const f of options[s]) {
        frets[s] = f;
        walk(s + 1);
      }
      frets[s] = -1;
    };
    walk(0);
  }
  const found = best as { frets: number[]; cost: number } | null;
  const result = found ? { frets: found.frets, base: baseFret(found.frets) } : null;
  cache.set(key, result);
  return result;
}

// Formas móviles clásicas (afinación estándar), relativas al traste de la cejilla.
const CAGED = [
  [0, 2, 2, 1, 0, 0], [0, 2, 2, 0, 0, 0], [0, 2, 0, 1, 0, 0], [0, 2, 0, 0, 0, 0], [0, 2, 1, 1, 0, 0],
  [-1, 0, 2, 2, 2, 0], [-1, 0, 2, 2, 1, 0], [-1, 0, 2, 0, 2, 0], [-1, 0, 2, 0, 1, 0], [-1, 0, 2, 1, 2, 0],
];

function isCagedShape(frets: number[], tuning: number[]): boolean {
  if (tuning.join() !== '40,45,50,55,59,64') return false;
  return CAGED.some((shape) => {
    const p = frets[shape.findIndex((x) => x >= 0)];
    return p > 0 && shape.every((x, i) => (x < 0 ? frets[i] < 0 : frets[i] === x + p));
  });
}

function baseFret(frets: number[]): number {
  const fretted = frets.filter((f) => f > 0);
  const hi = Math.max(0, ...fretted);
  return hi <= 4 ? 1 : Math.min(...fretted);
}

/** Diagrama SVG clásico: cuerdas verticales, trastes horizontales. */
export function voicingSvg(v: Voicing, name: string): string {
  const n = v.frets.length;
  const W = 120;
  const H = 150;
  const left = 18;
  const top = 34;
  const gap = (W - left * 2) / (n - 1);
  const fh = 22;
  const x = (s: number) => left + s * gap;
  const parts: string[] = [];
  parts.push(`<text x="${W / 2}" y="14" text-anchor="middle" class="vd-name">${name}</text>`);
  if (v.base === 1) parts.push(`<rect x="${left}" y="${top - 4}" width="${W - left * 2}" height="4" class="vd-nut"/>`);
  else parts.push(`<text x="4" y="${top + fh / 2 + 4}" class="vd-base">${v.base}</text>`);
  for (let f = 0; f <= 5; f++) parts.push(`<line x1="${left}" x2="${W - left}" y1="${top + f * fh}" y2="${top + f * fh}" class="vd-line"/>`);
  for (let s = 0; s < n; s++) parts.push(`<line x1="${x(s)}" x2="${x(s)}" y1="${top}" y2="${top + 5 * fh}" class="vd-line"/>`);
  v.frets.forEach((f, s) => {
    if (f < 0) parts.push(`<text x="${x(s)}" y="${top - 9}" text-anchor="middle" class="vd-mark">×</text>`);
    else if (f === 0) parts.push(`<circle cx="${x(s)}" cy="${top - 13}" r="4" class="vd-open"/>`);
    else parts.push(`<circle cx="${x(s)}" cy="${top + (f - v.base + 0.5) * fh}" r="7" class="vd-dot"/>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagrama de ${name}">${parts.join('')}</svg>`;
}
