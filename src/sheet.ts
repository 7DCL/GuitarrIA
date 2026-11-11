// Vista de partitura + tablatura con alphaTab (código abierto). Se carga solo al abrir la vista,
// porque la librería pesa ~1 MB. Recibe MusicXML generado por notation.ts.
import type * as AT from '@coderline/alphatab';

export type SheetProfile = 'scoretab' | 'score' | 'tab';

type AlphaTab = typeof AT;
let lib: Promise<AlphaTab> | null = null;
const load = () => (lib ??= import('@coderline/alphatab'));

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class SheetView {
  private api: AT.AlphaTabApi | null = null;
  private at: AlphaTab | null = null;
  private beatsByEvent: AT.model.Beat[] = [];
  private eventByBeat = new Map<AT.model.Beat, number>();
  private cursor: HTMLDivElement;
  private selBox: HTMLDivElement;
  private host: HTMLDivElement;
  private current = -1;
  private selected = -1;
  private pending: Promise<void> = Promise.resolve();
  score: AT.model.Score | null = null;
  rendering = false;
  onRendered: () => void = () => {};

  constructor(
    private wrap: HTMLElement,
    private onBeatClick: (event: number) => void,
  ) {
    this.host = document.createElement('div');
    this.host.className = 'sheet-host';
    this.cursor = document.createElement('div');
    this.cursor.className = 'sheet-cursor';
    this.cursor.hidden = true;
    this.selBox = document.createElement('div');
    this.selBox.className = 'sheet-sel';
    this.selBox.hidden = true;
    wrap.append(this.host, this.cursor, this.selBox);
    wrap.addEventListener('click', (e) => {
      const lookup = this.api?.renderer.boundsLookup;
      if (!lookup) return;
      const r = this.host.getBoundingClientRect();
      const beat = lookup.getBeatAtPos(e.clientX - r.left, e.clientY - r.top);
      if (!beat) return;
      // Un silencio o una nota ligada: se usa la nota anterior que suena.
      let b: AT.model.Beat | null = beat;
      while (b && !this.eventByBeat.has(b)) b = b.previousBeat;
      if (b) this.onBeatClick(this.eventByBeat.get(b)!);
    });
  }

  private async ensureApi(profile: SheetProfile): Promise<AlphaTab> {
    const at = (this.at ??= await load());
    if (!this.api) {
      const s = new at.Settings();
      s.core.fontDirectory = `${import.meta.env.BASE_URL}alphatab/font/`;
      s.core.useWorkers = false; // sin worker: más simple de servir desde GitHub Pages y suficiente para una canción
      s.core.enableLazyLoading = false; // todas las posiciones disponibles para seguir la reproducción
      s.player.enablePlayer = false; // suena nuestro reproductor (audio original o sintetizado)
      s.display.layoutMode = at.LayoutMode.Page;
      s.display.scale = 0.9;
      s.notation.elements.set(at.NotationElement.ChordDiagrams, false);
      s.notation.elements.set(at.NotationElement.GuitarTuning, false); // el texto sale en inglés; la afinación ya se ve en la app
      const text = at.model.Color.fromJson(css('--text', '#2b2118'))!;
      const muted = at.model.Color.fromJson(css('--muted', '#7a6a58'))!;
      const res = s.display.resources;
      res.mainGlyphColor = text;
      res.secondaryGlyphColor = muted;
      res.scoreInfoColor = text;
      res.staffLineColor = muted;
      res.barSeparatorColor = muted;
      res.barNumberColor = muted;
      this.api = new at.AlphaTabApi(this.host, s);
      this.api.postRenderFinished.on(() => {
        this.rendering = false;
        this.mapBeats();
        this.place(this.cursor, this.current);
        this.place(this.selBox, this.selected);
        this.onRendered();
      });
      this.api.error.on((e) => {
        this.rendering = false;
        console.error('alphaTab', e);
      });
    }
    this.setProfile(profile, false);
    return at;
  }

  private setProfile(profile: SheetProfile, rerender = true) {
    if (!this.api || !this.at) return;
    const P = this.at.StaveProfile;
    const want = profile === 'score' ? P.Score : profile === 'tab' ? P.Tab : P.ScoreTab;
    if (this.api.settings.display.staveProfile === want) return;
    this.api.settings.display.staveProfile = want;
    this.api.updateSettings();
    if (rerender && this.score) {
      this.rendering = true;
      this.api.render();
    }
  }

  /** Dibuja la partitura. `tuning` de grave a aguda; alphaTab la guarda de aguda a grave. */
  render(xml: string, tuning: number[], capo: number, profile: SheetProfile): Promise<void> {
    // Las llamadas se encadenan: si llegan varias seguidas, se dibuja en orden y sin solaparse.
    this.pending = this.pending.then(async () => {
      const at = await this.ensureApi(profile);
      const score = at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), this.api!.settings);
      prepare(score, tuning, capo);
      this.score = score;
      this.rendering = true;
      this.api!.renderScore(score, [0]);
    });
    return this.pending;
  }

  profile(p: SheetProfile) {
    this.setProfile(p);
  }

  private mapBeats() {
    this.beatsByEvent = [];
    this.eventByBeat.clear();
    const staff = this.score?.tracks[0]?.staves[0];
    if (!staff) return;
    for (const bar of staff.bars)
      for (const beat of bar.voices[0].beats) {
        if (beat.isRest || !beat.notes.length || beat.notes.every((n) => n.isTieDestination)) continue;
        this.eventByBeat.set(beat, this.beatsByEvent.length);
        this.beatsByEvent.push(beat);
      }
  }

  get beatCount() {
    return this.beatsByEvent.length;
  }

  private place(box: HTMLDivElement, event: number) {
    const beat = this.beatsByEvent[event];
    const b = beat && this.api?.renderer.boundsLookup?.findBeat(beat);
    if (!b) {
      box.hidden = true;
      return;
    }
    const bar = b.barBounds.masterBarBounds.visualBounds;
    const v = b.visualBounds;
    box.hidden = false;
    box.style.left = `${this.host.offsetLeft + v.x - 3}px`;
    box.style.top = `${this.host.offsetTop + bar.y}px`;
    box.style.width = `${Math.max(10, v.w + 6)}px`;
    box.style.height = `${bar.h}px`;
  }

  /** Marca la nota que suena; si se sale de la vista, desplaza el contenedor. */
  highlight(event: number) {
    if (event === this.current) return;
    this.current = event;
    this.place(this.cursor, event);
    if (this.cursor.hidden) return;
    const top = this.cursor.offsetTop;
    const h = this.cursor.offsetHeight;
    if (top < this.wrap.scrollTop || top + h > this.wrap.scrollTop + this.wrap.clientHeight)
      this.wrap.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' });
  }

  select(event: number) {
    this.selected = event;
    this.place(this.selBox, event);
  }

  /** Archivo de Guitar Pro 7 (.gp) de la partitura actual. */
  async guitarPro(): Promise<Uint8Array | null> {
    const at = (this.at ??= await load());
    if (!this.score || !this.api) return null;
    return new at.exporter.Gp7Exporter().export(this.score, this.api.settings);
  }

  /** Abre la partitura en una ventana lista para imprimir o guardar como PDF. */
  print() {
    this.api?.print('210mm');
  }
}

/** Afinación, capo y pentagramas (partitura + tab) en la partitura importada. */
function prepare(score: AT.model.Score, tuning: number[], capo: number) {
  for (const track of score.tracks)
    for (const staff of track.staves) {
      staff.stringTuning.tunings = [...tuning].reverse();
      staff.capo = capo;
      staff.showStandardNotation = true;
      staff.showTablature = true;
    }
}

/** Guitar Pro sin necesidad de dibujar: importa el MusicXML y lo exporta. */
export async function musicXmlToGp(xml: string, tuning: number[], capo: number): Promise<Uint8Array> {
  const at = await load();
  const settings = new at.Settings();
  const score = at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings);
  prepare(score, tuning, capo);
  return new at.exporter.Gp7Exporter().export(score, settings);
}
