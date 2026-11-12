import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { assignFingering } from '../src/fingering';
import { buildBars, spell, toMusicXml } from '../src/notation';
import { barTicks, quantize, withTempo, analyzeRhythm } from '../src/rhythm';

const TUNING = [40, 45, 50, 55, 59, 64];
function song() {
  // Negras a 120 BPM: Mi Sol La Si Do Mi y un acorde final (Do grave + Sol agudo).
  const notes = [0, 0.5, 1, 1.5, 2, 2.5].map((t, i) => ({ start: 0.5 + t, duration: 0.45, midi: [52, 55, 57, 59, 60, 64][i], velocity: 0.8 }));
  notes.push({ start: 3.5, duration: 1.8, midi: 48, velocity: 0.8 }, { start: 3.5, duration: 1.8, midi: 67, velocity: 0.8 });
  const ev = assignFingering(notes, { tuning: TUNING });
  const r = withTempo(analyzeRhythm(ev), 120, 6);
  const q = quantize(ev, r);
  const chords = [{ start: 0.5, end: 3.4, name: 'Am', root: 9, quality: 'm', bass: 9 }];
  return { ev, r, q, bars: buildBars(ev, q, r, chords) };
}
const INSTR = { name: 'Guitarra', program: 26, clef: 'treble8' as const };

describe('partitura', () => {
  it('cada compás suma exactamente su duración', () => {
    const { bars, r } = song();
    for (const b of bars) expect(b.items.reduce((s, it) => s + it.ticks, 0)).toBe(barTicks(r));
  });

  it('las notas largas que cruzan la barra se ligan', () => {
    const { bars } = song();
    const items = bars.flatMap((b) => b.items).filter((i) => i.notes.length === 2);
    expect(items.length).toBeGreaterThan(1);
    expect(items[0].tieStart).toBe(true);
    expect(items[items.length - 1].tieStop).toBe(true);
  });

  it('escribe las notas con sostenidos o bemoles según la armadura', () => {
    expect(spell(61, 2)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(spell(61, -3)).toEqual({ step: 'D', alter: -1, octave: 4 });
  });

  it('MusicXML válido que alphaTab importa con cuerdas, trastes, cifrado y exporta a Guitar Pro', () => {
    const { bars, r } = song();
    const xml = toMusicXml(bars, r, { title: 'Prueba & <test>', tuning: TUNING, capo: 0, instrument: INSTR, staffLines: 6 });
    expect(xml).toContain('<work-title>Prueba &amp; &lt;test&gt;</work-title>');
    expect(xml).toContain('<kind text="m">minor</kind>');
    const settings = new alphaTab.Settings();
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings);
    const staff = score.tracks[0].staves[0];
    expect([...staff.stringTuning.tunings]).toEqual([...TUNING].reverse());
    const played = staff.bars.flatMap((b) => b.voices[0].beats).filter((b) => !b.isRest && !b.notes[0].isTieDestination);
    // alphaTab numera las cuerdas desde la más grave (1) y calcula la altura con la afinación.
    expect(played.map((b) => b.notes.map((n) => n.realValue).sort((a, c) => a - c))).toEqual([[52], [55], [57], [59], [60], [64], [48, 67]]);
    expect(score.tempo).toBe(120);
    const gp = new alphaTab.exporter.Gp7Exporter().export(score, settings);
    expect(gp.length).toBeGreaterThan(1000);
    const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(gp, settings);
    expect(back.tracks[0].staves[0].bars.length).toBe(staff.bars.length);
  });
});
