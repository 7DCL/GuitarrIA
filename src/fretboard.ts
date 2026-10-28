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
  frets: number;
  showNames: boolean;
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function drawFretboard(canvas: HTMLCanvasElement, s: FretboardState): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const nStrings = s.tuning.length;
  const left = 34;
  const right = 10;
  const top = 18;
  const bottom = 22;
  const nutX = left + 18;
  const fretW = (w - nutX - right) / s.frets;
  const strGap = (h - top - bottom) / (nStrings - 1);
  const xFor = (fret: number) => (fret === 0 ? left + 6 : nutX + (fret - 0.5) * fretW);
  // Cuerda aguda arriba, igual que en la tab.
  const yFor = (string: number) => top + (nStrings - 1 - string) * strGap;

  g.fillStyle = css('--wood');
  g.fillRect(nutX, top - 8, w - nutX - right, h - top - bottom + 16);

  g.fillStyle = css('--inlay');
  for (const f of INLAYS) {
    if (f > s.frets) continue;
    g.beginPath();
    g.arc(nutX + (f - 0.5) * fretW, (top + h - bottom) / 2, 5, 0, Math.PI * 2);
    g.fill();
  }
  if (s.frets >= 12) {
    for (const dy of [-strGap, strGap]) {
      g.beginPath();
      g.arc(nutX + 11.5 * fretW, (top + h - bottom) / 2 + dy, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.strokeStyle = css('--fret');
  for (let f = 1; f <= s.frets; f++) {
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(nutX + f * fretW, top - 8);
    g.lineTo(nutX + f * fretW, h - bottom + 8);
    g.stroke();
  }
  g.fillStyle = css('--nut');
  g.fillRect(nutX - 4, top - 8, 5, h - top - bottom + 16);

  g.fillStyle = css('--muted');
  g.font = '11px system-ui, sans-serif';
  g.textAlign = 'center';
  for (let f = 1; f <= s.frets; f++) {
    const label = s.capo ? String(f + s.capo) : String(f);
    g.fillText(label, nutX + (f - 0.5) * fretW, h - 6);
  }

  for (let i = 0; i < nStrings; i++) {
    const y = yFor(i);
    g.strokeStyle = css('--string');
    g.lineWidth = 0.8 + (nStrings - 1 - i) * 0.35; // graves más gruesas
    g.beginPath();
    g.moveTo(nutX, y);
    g.lineTo(w - right, y);
    g.stroke();
    g.fillStyle = css('--muted');
    g.textAlign = 'left';
    g.fillText(noteName(s.tuning[i] + s.capo), 6, y + 4);
  }

  // Notas próximas (anillo que se cierra) y notas sonando (punto lleno).
  const t = s.time;
  for (const ev of s.events) {
    if (ev.start > t + LOOKAHEAD) break;
    for (const n of ev.notes) {
      const end = n.start + Math.max(n.duration, 0.12);
      if (end < t) continue;
      const x = xFor(n.fret);
      const y = yFor(n.string);
      if (n.start > t) {
        const k = (n.start - t) / LOOKAHEAD;
        g.strokeStyle = css('--accent');
        g.globalAlpha = 1 - k;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 9 + k * 14, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else {
        g.fillStyle = css('--accent');
        g.beginPath();
        g.arc(x, y, 10, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = css('--on-accent');
        g.font = 'bold 11px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(s.showNames ? noteName(n.midi) : String(n.fret), x, y + 4);
        g.font = '11px system-ui, sans-serif';
      }
    }
  }
}
