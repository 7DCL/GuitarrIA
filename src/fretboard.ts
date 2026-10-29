// Diapasón animado en <canvas>: muestra las notas que suenan y las que vienen.
import type { Event } from './fingering';
import { noteName } from './theory';

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const LOOKAHEAD = 0.7; // segundos de anticipación

export interface FretboardState {
  tuning: number[];
  capo: number;
  events: Event[];
  time: number;
  frets: number; // trastes a mostrar por encima del capo
  showNames: boolean;
}

// Los colores se leen del CSS una vez (y otra vez si cambia el tema), no en cada fotograma.
let colors: Record<string, string> | null = null;
const VARS = ['--wood', '--inlay', '--fret', '--nut', '--muted', '--string', '--accent', '--on-accent', '--capo'];
function palette(): Record<string, string> {
  if (!colors) {
    const cs = getComputedStyle(document.documentElement);
    colors = Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(v).trim()]));
  }
  return colors;
}
if (typeof window !== 'undefined')
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => (colors = null));

export function drawFretboard(canvas: HTMLCanvasElement, s: FretboardState): void {
  const c = palette();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const capo = s.capo;
  const total = Math.min(24, s.frets + capo); // el diapasón real, desde la cejuela
  const nStrings = s.tuning.length;
  const left = 34;
  const right = 10;
  const top = 22;
  const bottom = 24;
  const nutX = left + 18;
  const fretW = (w - nutX - right) / total;
  const strGap = (h - top - bottom) / (nStrings - 1);
  const dot = Math.max(6, Math.min(10, strGap * 0.45, fretW * 0.42));
  const capoX = nutX + (capo - 0.3) * fretW;
  // Traste relativo al capo → posición en pantalla. Al aire con capo = sobre la barra del capo.
  const xFor = (fret: number) => (fret === 0 ? (capo ? capoX : left + 6) : nutX + (capo + fret - 0.5) * fretW);
  // Cuerda aguda arriba, igual que en la tab.
  const yFor = (string: number) => top + (nStrings - 1 - string) * strGap;
  const midY = (top + h - bottom) / 2;

  g.fillStyle = c['--wood'];
  g.fillRect(nutX, top - 8, w - nutX - right, h - top - bottom + 16);

  g.fillStyle = c['--inlay'];
  const r = Math.min(5, fretW * 0.2);
  for (const f of INLAYS) {
    if (f > total) continue;
    g.beginPath();
    g.arc(nutX + (f - 0.5) * fretW, midY, r, 0, Math.PI * 2);
    g.fill();
  }
  for (const f of [12, 24]) {
    if (f > total) continue;
    for (const dy of [-strGap, strGap]) {
      g.beginPath();
      g.arc(nutX + (f - 0.5) * fretW, midY + dy, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.strokeStyle = c['--fret'];
  g.lineWidth = 2;
  for (let f = 1; f <= total; f++) {
    g.beginPath();
    g.moveTo(nutX + f * fretW, top - 8);
    g.lineTo(nutX + f * fretW, h - bottom + 8);
    g.stroke();
  }
  g.fillStyle = c['--nut'];
  g.fillRect(nutX - 4, top - 8, 5, h - top - bottom + 16);

  // Números de traste reales (los que ve el guitarrista en su mástil).
  g.fillStyle = c['--muted'];
  g.font = '11px system-ui, sans-serif';
  g.textAlign = 'center';
  const step = fretW < 16 ? 2 : 1;
  for (let f = 1; f <= total; f += step) g.fillText(String(f), nutX + (f - 0.5) * fretW, h - 6);

  for (let i = 0; i < nStrings; i++) {
    const y = yFor(i);
    g.strokeStyle = c['--string'];
    g.lineWidth = 0.8 + (nStrings - 1 - i) * 0.35; // graves más gruesas
    g.beginPath();
    g.moveTo(nutX, y);
    g.lineTo(w - right, y);
    g.stroke();
    g.fillStyle = c['--muted'];
    g.textAlign = 'left';
    g.fillText(noteName(s.tuning[i] + capo), 6, y + 4);
  }

  if (capo) {
    g.fillStyle = c['--capo'] || '#222';
    g.beginPath();
    g.roundRect?.(capoX - 5, top - 12, 10, h - top - bottom + 24, 4);
    if (!g.roundRect) g.rect(capoX - 5, top - 12, 10, h - top - bottom + 24);
    g.fill();
  }

  // Notas próximas (anillo que se cierra) y notas sonando (punto lleno).
  const t = s.time;
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  for (const ev of s.events) {
    if (ev.start > t + LOOKAHEAD) break;
    if (ev.end < t - 3) continue;
    for (const n of ev.notes) {
      const end = n.start + Math.max(n.duration, 0.12);
      if (end < t) continue;
      const x = xFor(n.fret);
      const y = yFor(n.string);
      if (n.start > t) {
        const k = (n.start - t) / LOOKAHEAD;
        g.strokeStyle = c['--accent'];
        g.globalAlpha = 1 - k;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, dot + k * Math.min(12, strGap * 0.8), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else {
        g.fillStyle = c['--accent'];
        g.beginPath();
        g.arc(x, y, dot, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = c['--on-accent'];
        g.font = `bold ${Math.round(dot * 1.1)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText(s.showNames ? noteName(n.midi) : String(n.fret + capo), x, y + dot * 0.4);
      }
    }
  }
  g.restore();
}
