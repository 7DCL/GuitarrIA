// Partitura: compases con figuras, silencios y ligaduras a partir de los eventos cuantizados,
// y exportación a MusicXML (lo abren MuseScore, Guitar Pro, Sibelius, Finale, Dorico…).
import type { ChordSegment } from './chords';
import type { Event } from './fingering';
import { barTicks, splitDuration, tickToTime, timeToTick, valueOf, type QEvent, type Rhythm } from './rhythm';

export interface SheetNote {
  midi: number;
  string: number; // 0 = cuerda más grave
  fret: number; // relativo al capo
}

export interface SheetItem {
  tick: number; // desde el compás 1
  ticks: number; // figura escribible (1, 2, 3, 4, 6, 8, 12, 16)
  notes: SheetNote[]; // vacío = silencio
  event: number; // índice del evento (-1 en silencios)
  tieStart: boolean;
  tieStop: boolean;
  chord: ChordSegment | null; // cifrado que empieza aquí
}

export interface Bar {
  number: number; // 1..
  items: SheetItem[];
}

/** Arma los compases: cada evento se parte en figuras (ligadas) y los huecos se rellenan con silencios. */
export function buildBars(events: Event[], q: QEvent[], r: Rhythm, chords: ChordSegment[] = []): Bar[] {
  const bt = barTicks(r);
  const lastTick = q.length ? Math.max(...q.map((x) => x.tick + x.dur)) : bt;
  const nBars = Math.max(1, Math.ceil(lastTick / bt));
  const bars: Bar[] = Array.from({ length: nBars }, (_, i) => ({ number: i + 1, items: [] }));
  const rest = (tick: number, dur: number) => {
    for (const p of splitDuration(tick, dur, bt))
      bars[Math.floor(p.tick / bt)].items.push({ tick: p.tick, ticks: p.ticks, notes: [], event: -1, tieStart: false, tieStop: false, chord: null });
  };
  let cursor = 0;
  for (const x of q) {
    if (x.tick > cursor) rest(cursor, x.tick - cursor);
    const ev = events[x.index];
    const notes = ev.notes.map((n) => ({ midi: n.midi, string: n.string, fret: n.fret })).sort((a, b) => a.midi - b.midi);
    const parts = splitDuration(x.tick, x.dur, bt);
    parts.forEach((p, i) =>
      bars[Math.floor(p.tick / bt)].items.push({
        tick: p.tick,
        ticks: p.ticks,
        notes,
        event: x.index,
        tieStart: i < parts.length - 1,
        tieStop: i > 0,
        chord: null,
      }),
    );
    cursor = x.tick + x.dur;
  }
  if (cursor < nBars * bt) rest(cursor, nBars * bt - cursor);

  // Cifrados: cada cambio de acorde va en la figura que suena en ese momento.
  const items = bars.flatMap((b) => b.items);
  let prev = '';
  for (const seg of chords) {
    if (seg.root < 0) continue;
    const key = `${seg.root}${seg.quality}/${seg.bass}`;
    if (key === prev) continue;
    const tick = Math.round(timeToTick(r, seg.start));
    let it = items.find((x) => x.tick >= tick - 1 && !x.tieStop) ?? null;
    if (it && it.tick > tick + bt) it = null; // demasiado lejos: no hay figura en ese compás
    if (it && !it.chord) {
      it.chord = seg;
      prev = key;
    }
  }
  return bars;
}

/** Segundos en que empieza cada figura (para seguir la reproducción en la partitura). */
export function itemTime(r: Rhythm, it: SheetItem): number {
  return tickToTime(r, it.tick);
}

// ---------- Nombres de nota para MusicXML ----------
const SHARP_STEPS: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_STEPS: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** Nota MIDI → nombre (escalón, alteración, octava), con sostenidos o bemoles según la armadura. */
export function spell(midi: number, key: number): { step: string; alter: number; octave: number } {
  const [step, alter] = (key < 0 ? FLAT_STEPS : SHARP_STEPS)[midi % 12];
  // La octava es la del escalón escrito (Cb4 = B3, B#3 = C4); con estas tablas no hace falta corregir.
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

const KINDS: Record<string, [string, string]> = {
  '': ['major', ''],
  m: ['minor', 'm'],
  '7': ['dominant', '7'],
  maj7: ['major-seventh', 'maj7'],
  m7: ['minor-seventh', 'm7'],
  sus2: ['suspended-second', 'sus2'],
  sus4: ['suspended-fourth', 'sus4'],
  dim: ['diminished', 'dim'],
  aug: ['augmented', 'aug'],
  '5': ['power', '5'],
  m7b5: ['half-diminished', 'm7b5'],
  dim7: ['diminished-seventh', 'dim7'],
  '6': ['major-sixth', '6'],
  m6: ['minor-sixth', 'm6'],
  add9: ['major', 'add9'],
  '7sus4': ['suspended-fourth', '7sus4'],
  '9': ['dominant-ninth', '9'],
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface InstrumentInfo {
  name: string; // "Guitarra", "Bajo", "Ukelele"
  program: number; // General MIDI 1..128
  clef: 'treble8' | 'bass8' | 'treble';
}

export interface MusicXmlOptions {
  title: string;
  tuning: number[]; // de grave a aguda
  capo: number;
  instrument: InstrumentInfo;
  /** alphaTab cuenta las cuerdas por las líneas del pentagrama: para su vista previa se pasa el nº de cuerdas. */
  staffLines?: number;
}

/** MusicXML 4.0 con un pentagrama que lleva cuerda y traste en cada nota (los editores muestran partitura + tab). */
export function toMusicXml(bars: Bar[], r: Rhythm, opts: MusicXmlOptions): string {
  const { tuning, capo, instrument } = opts;
  const out: string[] = [];
  const w = (s: string) => out.push(s);
  w('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');
  w(`<work><work-title>${esc(opts.title)}</work-title></work>`);
  w('<identification><encoding><software>GuitarrIA</software></encoding></identification>');
  w('<part-list><score-part id="P1">');
  w(`<part-name>${esc(instrument.name)}</part-name>`);
  w(`<score-instrument id="P1-I1"><instrument-name>${esc(instrument.name)}</instrument-name></score-instrument>`);
  w(`<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>${instrument.program}</midi-program></midi-instrument>`);
  w('</score-part></part-list>');
  w('<part id="P1">');
  const divisions = 4; // ticks por negra (semicorcheas)
  const clef =
    instrument.clef === 'bass8'
      ? '<clef><sign>F</sign><line>4</line><clef-octave-change>-1</clef-octave-change></clef>'
      : instrument.clef === 'treble8'
        ? '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
        : '<clef><sign>G</sign><line>2</line></clef>';
  const staffTuning = tuning
    .map((m, i) => {
      const p = spell(m, 0);
      return `<staff-tuning line="${i + 1}"><tuning-step>${p.step}</tuning-step>${p.alter ? `<tuning-alter>${p.alter}</tuning-alter>` : ''}<tuning-octave>${p.octave}</tuning-octave></staff-tuning>`;
    })
    .join('');

  for (const bar of bars) {
    w(`<measure number="${bar.number}">`);
    if (bar.number === 1) {
      w('<attributes>');
      w(`<divisions>${divisions}</divisions>`);
      w(`<key><fifths>${r.key}</fifths><mode>${r.minor ? 'minor' : 'major'}</mode></key>`);
      w(`<time><beats>${r.beatsPerBar}</beats><beat-type>${r.beatUnit}</beat-type></time>`);
      w(clef);
      w(`<staff-details><staff-lines>${opts.staffLines ?? 5}</staff-lines>${staffTuning}${capo ? `<capo>${capo}</capo>` : ''}</staff-details>`);
      w('</attributes>');
      const bpm = Math.round(r.bpm);
      w(
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`,
      );
    }
    for (const it of bar.items) {
      if (it.chord) {
        const c = it.chord;
        const root = spell(c.root + 60, r.key);
        const [kind, text] = KINDS[c.quality] ?? ['other', c.quality];
        const bass = c.bass >= 0 && c.bass !== c.root ? spell(c.bass + 60, r.key) : null;
        w(
          `<harmony><root><root-step>${root.step}</root-step>${root.alter ? `<root-alter>${root.alter}</root-alter>` : ''}</root>` +
            `<kind text="${esc(text)}">${kind}</kind>` +
            (bass ? `<bass><bass-step>${bass.step}</bass-step>${bass.alter ? `<bass-alter>${bass.alter}</bass-alter>` : ''}</bass>` : '') +
            '</harmony>',
        );
      }
      const v = valueOf(it.ticks);
      const dots = '<dot/>'.repeat(v.dots);
      if (!it.notes.length) {
        // Un compás entero de silencio se escribe como silencio de compás.
        const whole = it.ticks === barTicks(r) && bar.items.length === 1;
        w(`<note><rest${whole ? ' measure="yes"' : ''}/><duration>${it.ticks}</duration><voice>1</voice>${whole ? '' : `<type>${v.type}</type>${dots}`}</note>`);
        continue;
      }
      it.notes.forEach((n, i) => {
        const p = spell(n.midi, r.key);
        const ties = (it.tieStop ? '<tie type="stop"/>' : '') + (it.tieStart ? '<tie type="start"/>' : '');
        const tied = (it.tieStop ? '<tied type="stop"/>' : '') + (it.tieStart ? '<tied type="start"/>' : '');
        // En MusicXML la cuerda 1 es la más aguda.
        const technical = `<technical><string>${tuning.length - n.string}</string><fret>${n.fret}</fret></technical>`;
        w(
          `<note>${i ? '<chord/>' : ''}<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>` +
            `<duration>${it.ticks}</duration>${ties}<voice>1</voice><type>${v.type}</type>${dots}` +
            `<notations>${tied}${technical}</notations></note>`,
        );
      });
    }
    if (bar.number === bars.length) w('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    w('</measure>');
  }
  w('</part>');
  w('</score-partwise>');
  return out.join('\n');
}
