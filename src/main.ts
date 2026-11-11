import { Midi } from '@tonejs/midi';
import { chordAt, detectChords, framesFromNotes, type ChordSegment } from './chords';
import type { Mode } from './cleanup';
import { assignFingering, type Event, type Note } from './fingering';
import { drawFretboard } from './fretboard';
import { downloadWithLocal, localAvailable, localOptedIn, setLocalOptIn, LOCAL_DOWNLOAD } from './local';
import { AudioPlayer, ClockPlayer, YouTubePlayer, captureTabAudio, parseYouTubeId, type Player } from './player';
import { pluck, renderDemo } from './synth';
import { stringLabels, toAsciiTab } from './tab';
import { chordName, INSTRUMENTS, noteName, pcName, setNotation, TUNINGS, type InstrumentId, type Notation } from './theory';
import { analyzeRhythm, quantize, TPQ, withTempo, type QEvent, type Rhythm } from './rhythm';
import { buildBars, toMusicXml, type Bar } from './notation';
import { SheetView, musicXmlToGp, type SheetProfile } from './sheet';
import { cloneEvents, deleteEvent, History, insertAfter, moveEvent, notesFromEvents, setDuration, setFret } from './edit';
import { Tuner, type TunerReading } from './tuner';
import { analyze, toNotes, type NoiseLevel, type Prepared } from './pipeline';
import { findVoicing, voicingSvg } from './voicing';
import { encodeWav, download, formatTime, safeFileName } from './util';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const audioEl = $<HTMLAudioElement>('audio');
const audioPlayer = new AudioPlayer(audioEl);
let player: Player = audioPlayer;
let ytPlayer: YouTubePlayer | null = null;
let ytId: string | null = null;
const canvas = $<HTMLCanvasElement>('fretboard');
const tabEl = $('tab');
const tuningSel = $<HTMLSelectElement>('tuning');
const capoInput = $<HTMLInputElement>('capo');
const sensInput = $<HTMLInputElement>('sens');
const modeSel = $<HTMLSelectElement>('mode');
const noiseSel = $<HTMLSelectElement>('noise');
const namesInput = $<HTMLInputElement>('names');
const workspace = $('workspace');
const progressRow = $('progressRow');
const progressBar = $('progress').querySelector('div')!;
const progressLabel = $('progress').querySelector('span')!;
const errorEl = $('error');

const state = {
  name: 'cancion',
  buffer: null as AudioBuffer | null,
  prepared: null as Prepared | null,
  analyzedLowest: 40, // nota más grave usada para filtrar el audio en el último análisis
  offset: 0, // segundos entre el inicio de la grabación y el segundo 0 del video
  notes: [] as Note[],
  events: [] as Event[],
  chords: [] as ChordSegment[], // tramos de acorde de toda la canción ('N' = sin acorde)
  chordStarts: [] as (ChordSegment | null)[], // acorde que empieza en cada columna de la tab
  frets: 15,
  rate: 1,
  loopA: null as number | null,
  loopB: null as number | null,
  lastTime: 0,
  current: -1,
  chordShown: null as ChordSegment | null | undefined,
  dirty: true, // hay que redibujar el diapasón aunque el tiempo no cambie
  rhythm: null as Rhythm | null, // pulso, compás y tonalidad
  q: [] as QEvent[], // eventos en la cuadrícula (ticks)
  bars: [] as Bar[], // compases para la partitura
  rhythmLocked: false, // el usuario fijó tempo/compás/tonalidad: no se vuelve a detectar solo
  edited: false, // hay correcciones a mano
  selected: -1, // evento elegido en el editor
};

let ctx: AudioContext | null = null;
let synthOut: GainNode | null = null;
const audioCtx = () => {
  ctx ??= new AudioContext();
  if (!synthOut) {
    synthOut = ctx.createGain();
    synthOut.gain.value = Number($<HTMLInputElement>('volSynth').value);
    synthOut.connect(ctx.destination);
  }
  return ctx;
};

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(`guitarria.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`guitarria.${k}`, v);
    } catch {
      /* modo privado */
    }
  },
};

const instrumentSel = $<HTMLSelectElement>('instrument');
for (const [id, ins] of Object.entries(INSTRUMENTS)) instrumentSel.add(new Option(ins.label, id));
/** Llena las afinaciones del instrumento elegido. */
function fillTunings(instrument: InstrumentId, keep?: string) {
  instrumentSel.value = instrument;
  tuningSel.innerHTML = '';
  for (const [key, t] of Object.entries(TUNINGS)) if (t.instrument === instrument) tuningSel.add(new Option(t.label, key));
  if (keep && TUNINGS[keep]?.instrument === instrument) tuningSel.value = keep;
}
fillTunings('guitar');
for (const [key, t] of Object.entries(TUNINGS)) $<HTMLSelectElement>('tunerTuning').add(new Option(t.label, key));

// ---------- Mensajes y estado ocupado ----------
function showError(msg: string | null) {
  errorEl.textContent = msg ?? '';
  errorEl.hidden = !msg;
}

function setProgress(fraction: number | null, label: string) {
  progressRow.hidden = false;
  progressLabel.textContent = label;
  if (fraction === null) {
    progressBar.style.width = '100%';
    progressBar.classList.add('indeterminate');
  } else {
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = `${Math.round(fraction * 100)}%`;
    $('progress').setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }
}

// Cada carga o análisis recibe un número: si empieza otro, el resultado del anterior se descarta.
let generation = 0;
let abortLocal: AbortController | null = null;
const BUSY_IDS = ['ytLoad', 'pick', 'record', 'demo', 'mode', 'noise', 'sens', 'instrument', 'tuning', 'capo', 'impBtn'];
function setBusy(on: boolean) {
  for (const id of BUSY_IDS) ($(id) as HTMLButtonElement).disabled = on && !(id === 'record' && recorder);
  if (!on) progressRow.hidden = true;
}

$('cancel').addEventListener('click', () => {
  generation++;
  abortLocal?.abort();
  setBusy(false);
  setProgress(0, '');
  progressRow.hidden = true;
});

// ---------- Navegación ----------
function showView(view: string) {
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  });
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view !== 'tuner') stopTuner();
  else player.pause();
}
document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view!)));

// ---------- Notación ----------
const notationSel = $<HTMLSelectElement>('notation');
notationSel.value = store.get('notation') ?? 'sharp';
setNotation(notationSel.value as Notation);
notationSel.addEventListener('change', () => {
  setNotation(notationSel.value as Notation);
  store.set('notation', notationSel.value);
  renderTab();
  renderChordList();
  state.chordShown = undefined;
  state.dirty = true;
  renderTunerStrings();
});

// ---------- Entrada de audio ----------
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) loadBlob(f, f.name);
});
const fileInput = $<HTMLInputElement>('file');
$('pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = ''; // permite volver a elegir el mismo archivo
  if (f) loadBlob(f, f.name);
});
$('demo').addEventListener('click', async () => {
  const buf = await renderDemo();
  loadBlob(new Blob([encodeWav(buf)], { type: 'audio/wav' }), 'demo.wav');
});

function micError(err: unknown): string {
  const name = (err as Error)?.name;
  if (!window.isSecureContext) return 'El micrófono solo funciona en https.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Permiso de micrófono denegado: actívalo en el candado de la barra de direcciones.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró ningún micrófono.';
  if (name === 'NotReadableError') return 'Otra aplicación está usando el micrófono.';
  return 'No se pudo acceder al micrófono.';
}

let recorder: MediaRecorder | null = null;
$('record').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (recorder) {
    if (recorder.state !== 'inactive') recorder.stop();
    return;
  }
  showError(null);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    recorder = rec;
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      btn.textContent = '● Grabar con micrófono';
      btn.classList.remove('rec');
      if (chunks.length) loadBlob(new Blob(chunks, { type: chunks[0].type || rec.mimeType || 'audio/webm' }), 'grabacion');
    };
    rec.start(500);
    btn.textContent = '■ Parar y transcribir';
    btn.classList.add('rec');
  } catch (err) {
    showError(micError(err));
  }
});

// ---------- YouTube ----------
// Dos caminos: si GuitarrIA Local está abierto en el PC, baja el audio y transcribe al instante;
// si no, el video se incrusta y GuitarrIA graba el audio de la pestaña mientras suena.
const ytStatus = $('ytStatus');
const ytStart = $<HTMLButtonElement>('ytStart');
const ytStop = $<HTMLButtonElement>('ytStop');
let capture: { startedAt: number; stop: () => Promise<Blob>; yt: YouTubePlayer } | null = null;
let ytOffset: number | null = null;
$<HTMLAnchorElement>('localLink').href = LOCAL_DOWNLOAD;

function dropYouTube() {
  if (player instanceof ClockPlayer) player.destroy();
  if (player === ytPlayer || player instanceof ClockPlayer) player = audioPlayer;
  ytPlayer?.destroy();
  ytPlayer = null;
}

$('ytForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(null);
  const id = parseYouTubeId($<HTMLInputElement>('ytUrl').value);
  if (!id) {
    showError('No reconozco ese enlace de YouTube. Copia la dirección del video (youtube.com/watch?v=… o youtu.be/…).');
    return;
  }
  if (capture) await finishCapture(false);
  player.pause();
  dropYouTube();
  ytId = id;
  workspace.hidden = true;
  $('ytPanel').hidden = false;
  $('ytPanel').classList.add('compact');
  $('ytCapture').hidden = true;
  ytStatus.textContent = '';

  // El reproductor y GuitarrIA Local arrancan a la vez: la descarga no espera al video.
  const ytPromise = YouTubePlayer.create($('ytBox'), id).then(
    (yt) => {
      if (ytId !== id) {
        yt.destroy();
        return null;
      }
      ytPlayer = yt;
      showPaused(yt);
      yt.onEnded(() => capture?.yt === yt && finishCapture(true));
      // Alinear la grabación con el video: momento en que empieza a sonar de verdad.
      yt.onStateChange((paused) => {
        if (!paused && capture?.yt === yt && ytOffset === null) ytOffset = (performance.now() - capture.startedAt) / 1000 - yt.time;
      });
      return yt;
    },
    (err: Error) => err,
  );
  if (localOptedIn() && (await tryLocal(id, ytPromise))) return;
  const yt = await ytPromise;
  if (ytId !== id) return;
  showCapture(yt);
});

function showCapture(yt: YouTubePlayer | Error | null) {
  $('ytCapture').hidden = false;
  $('localTip').hidden = localOptedIn() && !ytStatus.textContent;
  if (!(yt instanceof YouTubePlayer)) {
    if (yt) ytStatus.textContent = yt.message;
    ytStart.hidden = true;
    return;
  }
  ytStart.hidden = false;
  $('ytPanel').classList.remove('compact');
  if (!ytStatus.textContent) ytStatus.textContent = `Dura ${formatTime(yt.duration)}: escuchándolo, la transcripción tarda lo mismo que el video.`;
}

/** Baja el audio con GuitarrIA Local y lo transcribe. Devuelve false si no está disponible o falla. */
async function tryLocal(id: string, ytPromise: Promise<YouTubePlayer | Error | null>): Promise<boolean> {
  if (!(await localAvailable())) {
    ytStatus.textContent = 'No encuentro GuitarrIA Local: ¿está abierta su ventana? Mientras tanto puedes transcribirlo escuchándolo.';
    return false;
  }
  const my = ++generation;
  setBusy(true);
  abortLocal = new AbortController();
  try {
    const { blob, title } = await downloadWithLocal(
      id,
      (f) => my === generation && setProgress(f < 0 ? null : f, f < 0 ? 'GuitarrIA Local está bajando el audio…' : `Recibiendo audio… ${Math.round(f * 100)}%`),
      abortLocal.signal,
    );
    if (my !== generation) return true;
    const yt = await ytPromise;
    if (my !== generation || ytId !== id) return true;
    // Si YouTube no deja incrustar el video, se toca el audio descargado.
    await loadBlob(blob, title, yt instanceof YouTubePlayer ? yt : undefined, 0, my);
    if (!(yt instanceof YouTubePlayer)) $('ytPanel').hidden = true;
    return true;
  } catch (err) {
    if (my !== generation) return true;
    setBusy(false);
    if ((err as Error).name === 'AbortError') return true;
    ytStatus.textContent = `GuitarrIA Local no pudo bajarlo: ${(err as Error).message} Puedes transcribirlo escuchándolo:`;
    return false;
  }
}

$('localUse').addEventListener('click', async () => {
  setLocalOptIn(true);
  if (!ytId) return;
  ytStatus.textContent = '';
  const id = ytId;
  const yt = ytPlayer;
  if (!(await tryLocal(id, Promise.resolve(yt)))) showCapture(yt);
});

ytStart.addEventListener('click', async () => {
  const yt = ytPlayer;
  if (!yt) {
    ytStatus.textContent = 'Primero carga un video con su enlace.';
    return;
  }
  if (capture) return;
  showError(null);
  try {
    yt.pause();
    yt.seek(0);
    const cap = await captureTabAudio(() => capture?.yt === yt && finishCapture(true));
    capture = { ...cap, yt };
  } catch (err) {
    ytStatus.textContent = (err as Error).name === 'NotAllowedError' ? 'Captura cancelada.' : (err as Error).message;
    return;
  }
  const cap = capture;
  ytOffset = null;
  yt.rate = 1;
  yt.volume = 1;
  yt.play();
  ytStart.hidden = true;
  ytStop.hidden = false;
  const tick = () => {
    if (capture !== cap) return;
    ytStatus.textContent = `Escuchando… ${formatTime(yt.time)} / ${formatTime(yt.duration)} (no pauses el video)`;
    setTimeout(tick, 500);
  };
  tick();
});
ytStop.addEventListener('click', () => finishCapture(true));

async function finishCapture(transcribe: boolean) {
  const cap = capture;
  if (!cap) return;
  capture = null;
  ytStart.hidden = false;
  ytStop.hidden = true;
  const blob = await cap.stop();
  cap.yt.pause();
  if (!transcribe || cap.yt !== ytPlayer) return;
  if (blob.size < 2000) {
    ytStatus.textContent = 'No se grabó audio. ¿Activaste "Compartir audio de la pestaña"?';
    return;
  }
  ytStatus.textContent = '';
  $('ytCapture').hidden = true;
  $('ytPanel').classList.add('compact');
  loadBlob(blob, cap.yt.title, cap.yt, ytOffset ?? 0);
}

/** Transcribe un audio. Si viene de YouTube, se reproduce con el video en vez de con el archivo. */
let objectUrl: string | null = null;
async function loadBlob(blob: Blob, name: string, source?: YouTubePlayer, offset = 0, my = ++generation) {
  player.pause();
  showError(null);
  setBusy(true);
  setProgress(0, 'Decodificando audio…');
  let buffer: AudioBuffer;
  try {
    buffer = await audioCtx().decodeAudioData(await blob.arrayBuffer());
  } catch (err) {
    console.error(err);
    if (my === generation) {
      setBusy(false);
      showError('No se pudo leer este audio. Prueba con mp3, wav, m4a u ogg.');
    }
    return;
  }
  if (my !== generation) return;
  if (buffer.duration < 0.5) {
    setBusy(false);
    showError('El audio es demasiado corto.');
    return;
  }
  // Solo ahora (con el audio ya leído) se cambia lo que suena.
  if (source) {
    player = source;
  } else {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audioEl.src = objectUrl;
    player = audioPlayer;
    dropYouTube();
    ytId = null;
    $('ytPanel').hidden = true;
  }
  state.offset = offset;
  state.name = safeFileName(name.replace(/\.[^.]+$/, ''));
  state.buffer = buffer;
  state.prepared = null;
  resetEditing();
  setRate(state.rate);
  player.volume = Number($<HTMLInputElement>('volAudio').value);
  playBtn.textContent = '▶';
  if (!(await analyzeBuffer(my))) return;
  workspace.hidden = false;
  drop.classList.add('later'); // con una canción cargada, la zona de subida pasa al final
  resetLoop();
  seek(0);
}

/** Pasa el audio por el filtro de ruido, la corrección de afinación y la IA. */
async function analyzeBuffer(my = ++generation): Promise<boolean> {
  if (!state.buffer) return false;
  setBusy(true);
  setProgress(0, 'La IA está escuchando… (la primera vez descarga el modelo)');
  const lowest = Math.min(...currentTuning());
  try {
    const prepared = await analyze(state.buffer, { noise: noiseSel.value as NoiseLevel, autoTune: true, lowestMidi: lowest }, (p, what) => {
      if (my === generation) setProgress(p, `${what}… ${Math.round(p * 100)}%`);
    });
    if (my !== generation) return false;
    state.prepared = prepared;
    state.analyzedLowest = lowest;
  } catch (err) {
    console.error(err);
    if (my === generation) {
      setBusy(false);
      showError(`La transcripción falló: ${(err as Error).message || err}. Recarga la página e inténtalo de nuevo.`);
    }
    return false;
  }
  setBusy(false);
  const c = Math.round(state.prepared.cents);
  $('tuneInfo').textContent =
    state.prepared.rate !== 1 ? `Tema desafinado ${c > 0 ? '+' : ''}${c} cents: corregido` : 'Afinación del tema: La 440';
  refreshChords();
  refreshNotes();
  return true;
}

// ---------- Transcripción → digitación ----------
const capo = () => {
  const v = Math.round(Number(capoInput.value));
  return Number.isFinite(v) ? Math.max(0, Math.min(12, v)) : 0;
};
const currentTuning = () => TUNINGS[tuningSel.value].strings;
const currentInstrument = () => INSTRUMENTS[TUNINGS[tuningSel.value].instrument];

function refreshNotes() {
  if (state.prepared && state.edited) {
    // Rehacer la transcripción pisa las correcciones: se guardan para poder deshacer.
    history.push(snapshot());
    state.edited = false;
    flashRhythm('Transcripción rehecha: «Deshacer» recupera tus correcciones');
  }
  if (state.prepared)
    state.notes = toNotes(state.prepared, {
      mode: modeSel.value as Mode,
      sensitivity: Number(sensInput.value),
      offset: state.offset,
      minMidi: Math.min(...currentTuning()) + capo(),
    });
  refreshFingering();
}

function refreshChords() {
  const frames = state.prepared ? state.prepared.raw.frames : framesFromNotes(state.notes);
  state.chords = detectChords(frames, { timeScale: state.prepared?.rate ?? 1, offset: state.prepared ? state.offset : 0 });
  renderChordList();
  state.chordShown = undefined;
}

function refreshFingering() {
  const tuning = currentTuning();
  setEvents(assignFingering(state.notes, { tuning, capo: capo(), maxFret: currentInstrument().maxFret }), !state.rhythmLocked);
}

/** Nuevos eventos digitados: tab, diapasón, ritmo y partitura. */
function setEvents(events: Event[], detectRhythm: boolean) {
  state.events = events;
  mapChordStarts();
  const maxFret = Math.max(0, ...state.events.flatMap((e) => e.notes.map((n) => n.fret)));
  state.frets = Math.min(22, Math.max(12, maxFret + 2));
  state.current = -1;
  state.chordShown = undefined;
  state.dirty = true;
  renderTab();
  refreshRhythm(detectRhythm);
  if (state.selected >= state.events.length) state.selected = state.events.length - 1;
  if (editInput.checked) selectEvent(state.selected);
}

function mapChordStarts() {
  // Nombre del acorde en la columna donde empieza cada tramo.
  state.chordStarts = state.events.map(() => null);
  let i = 0;
  for (const seg of state.chords) {
    if (seg.root < 0) continue;
    while (i < state.events.length && state.events[i].start < seg.start - 0.08) i++;
    if (i < state.events.length && state.events[i].start < seg.end) state.chordStarts[i] = seg;
  }
}

const segName = (s: ChordSegment) => chordName(s.root, s.quality, s.bass);

function renderTab() {
  const tuning = currentTuning();
  const labels = stringLabels(tuning);
  const strings = tuning.map((_, i) => i).reverse();
  const cols: string[] = [
    `<div class="col labels" aria-hidden="true"><div class="ch"></div>${strings.map((s) => `<div class="cell"><span>${labels[s]}</span></div>`).join('')}</div>`,
  ];
  state.events.forEach((ev, i) => {
    const cells = strings
      .map((s) => {
        const n = ev.notes.find((x) => x.string === s);
        return `<div class="cell">${n ? `<span>${n.fret}</span>` : ''}</div>`;
      })
      .join('');
    const seg = state.chordStarts[i];
    const desc = ev.notes.map((n) => `cuerda ${tuning.length - n.string} traste ${n.fret}`).join(', ');
    cols.push(
      `<div class="col${i === state.selected && editInput.checked ? ' sel' : ''}" role="listitem" tabindex="-1" data-i="${i}" aria-label="${formatTime(ev.start)}: ${desc}"><div class="ch">${seg ? segName(seg) : ''}</div>${cells}</div>`,
    );
  });
  tabEl.innerHTML = cols.join('');
  tabEl.tabIndex = 0;
  state.current = -1;
  markLoop();
}

tabEl.addEventListener('click', (e) => {
  const col = (e.target as HTMLElement).closest<HTMLElement>('.col[data-i]');
  if (col) pickEvent(Number(col.dataset.i));
});
// Con el teclado: ← → recorren las columnas de la tab, Intro salta a la elegida.
tabEl.addEventListener('keydown', (e) => {
  if (!state.events.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  const i = Math.max(0, editInput.checked && state.selected >= 0 ? state.selected : state.current);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? state.events.length - 1 : i + (e.key === 'ArrowRight' ? 1 : -1);
  pickEvent(Math.max(0, Math.min(state.events.length - 1, next)), 0.01);
});

function renderChordList() {
  const list = $('chordList');
  // Acordes distintos, en orden de aparición, con su duración total (los de paso muy cortos se omiten).
  const byName = new Map<string, { seg: ChordSegment; total: number }>();
  for (const s of state.chords) {
    if (s.root < 0) continue;
    const k = segName(s);
    const e = byName.get(k) ?? { seg: s, total: 0 };
    e.total += s.end - s.start;
    byName.set(k, e);
  }
  const items = [...byName.entries()].filter(([, v]) => v.total >= 0.6).slice(0, 24);
  const tuning = currentTuning();
  list.innerHTML = items.length
    ? items
        .map(([name, { seg }]) => {
          const v = findVoicing(((seg.root - capo()) % 12 + 12) % 12, seg.quality, ((seg.bass - capo()) % 12 + 12) % 12, tuning);
          return `<button class="chord-chip" type="button" data-name="${name}" title="Ir a ${name}">${v ? voicingSvg(v, name) : `<span class="chip-name">${name}</span>`}</button>`;
        })
        .join('')
    : '<span class="hint">No se detectaron acordes (¿solo una melodía?)</span>';
}

$('chordList').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.chord-chip');
  if (!btn) return;
  const segs = state.chords.filter((s) => s.root >= 0 && segName(s) === btn.dataset.name);
  if (!segs.length) return;
  // Siguiente vez que suena después de la posición actual (o la primera).
  const t = player.time;
  seek((segs.find((s) => s.start > t + 0.1) ?? segs[0]).start);
});

function showChord(t: number) {
  const seg = chordAt(state.chords, t);
  const cur = seg && seg.root >= 0 ? seg : null;
  if (cur === state.chordShown) return;
  state.chordShown = cur;
  $('chord').textContent = cur ? segName(cur) : '–';
  const k = capo();
  const shapeRoot = cur ? (((cur.root - k) % 12) + 12) % 12 : 0;
  const v = cur ? findVoicing(shapeRoot, cur.quality, (((cur.bass - k) % 12) + 12) % 12, currentTuning()) : null;
  const shapeName = cur ? chordName(shapeRoot, cur.quality, (((cur.bass - k) % 12) + 12) % 12) : '';
  $('chordDiagram').innerHTML = v ? voicingSvg(v, shapeName) : '';
  $('chordCapo').textContent = cur && k ? `Con capo ${k}: forma de ${shapeName}` : '';
  const idx = cur ? state.chords.indexOf(cur) : state.chords.findIndex((s) => s.start > t);
  const next = state.chords.slice(Math.max(0, idx + (cur ? 1 : 0))).find((s) => s.root >= 0 && s !== cur);
  $('chordNext').textContent = next ? segName(next) : '–';
}

instrumentSel.addEventListener('change', () => {
  fillTunings(instrumentSel.value as InstrumentId);
  onTuningChange();
});
tuningSel.addEventListener('change', onTuningChange);
function onTuningChange() {
  // El filtro de graves depende de la cuerda más grave (guitarra vs. bajo): si cambia mucho, se vuelve a analizar.
  if (state.buffer && noiseSel.value !== 'off' && Math.abs(Math.min(...currentTuning()) - state.analyzedLowest) >= 5) analyzeBuffer();
  else {
    refreshNotes();
    renderChordList();
  }
}
capoInput.addEventListener('change', () => {
  capoInput.value = String(capo());
  refreshNotes();
  renderChordList();
});
capoInput.addEventListener('input', () => {
  if (capoInput.value !== '' && Number(capoInput.value) === capo()) refreshNotes();
});
sensInput.addEventListener('input', () => ($('sensVal').textContent = `${Math.round(Number(sensInput.value) * 100)}%`));
sensInput.addEventListener('change', refreshNotes);
modeSel.addEventListener('change', refreshNotes);
noiseSel.addEventListener('change', () => analyzeBuffer());
namesInput.addEventListener('change', () => (state.dirty = true));

// ---------- Reproductor ----------
const playBtn = $<HTMLButtonElement>('play');
const seekInput = $<HTMLInputElement>('seek');
const rateSel = $<HTMLSelectElement>('rate');
const rampInput = $<HTMLInputElement>('ramp');

function togglePlay() {
  audioCtx().resume();
  if (player.paused) player.play();
  else player.pause();
}
playBtn.addEventListener('click', togglePlay);
const showPaused = (p: Player) =>
  p.onStateChange((paused) => {
    if (p !== player) return;
    playBtn.textContent = paused ? '▶' : '❚❚';
    playBtn.setAttribute('aria-label', paused ? 'Reproducir (espacio)' : 'Pausar (espacio)');
  });
showPaused(audioPlayer);

/** Cambia la velocidad y refleja en el selector la que de verdad se aplicó (YouTube solo admite algunas). */
function setRate(r: number) {
  player.rate = r;
  const real = Math.round((player.rate || r) * 100) / 100;
  state.rate = real;
  if (![...rateSel.options].some((o) => Number(o.value) === real)) {
    const opt = new Option(`${Math.round(real * 100)}%`, String(real));
    const after = [...rateSel.options].find((o) => Number(o.value) > real);
    rateSel.add(opt, after);
  }
  rateSel.value = String([...rateSel.options].find((o) => Number(o.value) === real)!.value);
  markLoop();
}
rateSel.addEventListener('change', () => setRate(Number(rateSel.value)));

// Mientras se arrastra la barra no se actualiza sola; YouTube salta al soltar (cada salto recarga el video).
let dragging = false;
seekInput.addEventListener('pointerdown', () => (dragging = true));
seekInput.addEventListener('input', () => {
  $('clock').textContent = `${formatTime(Number(seekInput.value))} / ${formatTime(player.duration)}`;
  if (player === audioPlayer) seek(Number(seekInput.value));
});
seekInput.addEventListener('change', () => {
  dragging = false;
  seek(Number(seekInput.value));
});
document.addEventListener('pointerup', () => (dragging = false));
$<HTMLInputElement>('volAudio').addEventListener('input', (e) => (player.volume = Number((e.target as HTMLInputElement).value)));
$<HTMLInputElement>('volSynth').addEventListener('input', (e) => {
  audioCtx();
  synthOut!.gain.value = Number((e.target as HTMLInputElement).value);
});

function seek(t: number) {
  const target = Math.max(0, Math.min(t, player.duration || t));
  player.seek(target);
  state.lastTime = target;
  state.dirty = true;
}

document.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if (el.matches('input, select, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if ($('view-transcribe').hidden || workspace.hidden) return;
  if (e.code === 'Space' && !el.matches('button')) {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowLeft') seek(player.time - (e.shiftKey ? 5 : 2));
  else if (e.key === 'ArrowRight') seek(player.time + (e.shiftKey ? 5 : 2));
  else if (e.key === 'a' || e.key === 'A') $('loopA').click();
  else if (e.key === 'b' || e.key === 'B') $('loopB').click();
  else if (e.key === 'Escape') resetLoop();
});

// ---------- Bucle A-B ----------
let loopMsg = '';
let loopMsgTimer = 0;
function flashLoop(msg: string) {
  loopMsg = msg;
  clearTimeout(loopMsgTimer);
  loopMsgTimer = window.setTimeout(() => {
    loopMsg = '';
    markLoop();
  }, 2500);
  markLoop();
}
$('loopA').addEventListener('click', () => {
  state.loopA = player.time;
  if (state.loopB !== null && state.loopB <= state.loopA + 0.2) state.loopB = null;
  if (state.loopB === null) flashLoop('Inicio marcado: ahora pulsa B donde termine el bucle');
  else markLoop();
});
$('loopB').addEventListener('click', () => {
  const a = state.loopA ?? 0;
  if (player.time <= a + 0.2) {
    flashLoop('B debe ir después de A: avanza un poco y vuelve a pulsar B');
    return;
  }
  state.loopA = a;
  state.loopB = player.time;
  loopMsg = '';
  markLoop();
});
$('loopClear').addEventListener('click', resetLoop);

function resetLoop() {
  state.loopA = state.loopB = null;
  loopMsg = '';
  markLoop();
}

function markLoop() {
  const { loopA: a, loopB: b } = state;
  $('loopA').classList.toggle('on', a !== null);
  $('loopB').classList.toggle('on', b !== null);
  $('loopInfo').textContent =
    loopMsg ||
    (a !== null && b !== null ? `Bucle ${formatTime(a, true)} → ${formatTime(b, true)} · ${Math.round(state.rate * 100)}%` : '');
  tabEl.querySelectorAll<HTMLElement>('.col[data-i]').forEach((col) => {
    const ev = state.events[Number(col.dataset.i)];
    col.classList.toggle('loop', a !== null && b !== null && ev.start >= a && ev.start <= b);
  });
}

// ---------- Bucle de animación ----------
function eventIndexAt(t: number): number {
  let lo = 0;
  let hi = state.events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (state.events[mid].start <= t + 0.02) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

let lastDrawn = -1;
function frame() {
  try {
    render();
  } catch (err) {
    console.error(err);
  } finally {
    requestAnimationFrame(frame);
  }
}

function render() {
  if (workspace.hidden) return;
  let t = player.time;
  if (state.loopA !== null && state.loopB !== null && t >= state.loopB) {
    seek(state.loopA);
    t = state.loopA;
    if (rampInput.checked && state.rate < 1) setRate(Math.min(1, +(state.rate + 0.05).toFixed(2)));
  }

  // Sintetizador: solo notas que empiezan entre el fotograma anterior y este (sin ráfagas tras un salto).
  if (!player.paused && synthOut && synthOut.gain.value > 0 && ctx && t >= state.lastTime && t - state.lastTime < 0.25) {
    for (let i = Math.max(0, eventIndexAt(state.lastTime)); i < state.events.length; i++) {
      const ev = state.events[i];
      if (ev.start > t) break;
      if (ev.start > state.lastTime) ev.notes.forEach((n) => pluck(ctx!, synthOut!, n.midi, n.duration / state.rate, n.velocity));
    }
  }
  state.lastTime = t;

  $('clock').textContent = `${formatTime(t)} / ${formatTime(player.duration)}`;
  if (!dragging) {
    seekInput.max = String(player.duration || 1);
    seekInput.value = String(t);
  }

  const idx = eventIndexAt(t);
  if (idx !== state.current) {
    sheet?.highlight(idx);
    tabEl.querySelector('.col.now')?.classList.remove('now');
    const col = tabEl.querySelector<HTMLElement>(`.col[data-i="${idx}"]`);
    if (col) {
      col.classList.add('now');
      const left = col.offsetLeft - tabEl.clientWidth / 3;
      if (Math.abs(tabEl.scrollLeft - left) > tabEl.clientWidth / 3) tabEl.scrollLeft = left;
    }
    state.current = idx;
  }
  showChord(t);
  if (t !== lastDrawn || state.dirty) {
    lastDrawn = t;
    state.dirty = false;
    drawFretboard(canvas, {
      tuning: currentTuning(),
      capo: capo(),
      events: state.events,
      time: t,
      frets: state.frets,
      showNames: namesInput.checked,
    });
  }
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => (state.dirty = true));

// ---------- Exportar / importar ----------
$('expTxt').addEventListener('click', () => {
  const tuning = currentTuning();
  const k = capo();
  const shape = (s: ChordSegment) => chordName((((s.root - k) % 12) + 12) % 12, s.quality, (((s.bass - k) % 12) + 12) % 12);
  const names = state.chordStarts.map((s) => (s ? shape(s) : null));
  const header =
    `${state.name}\nAfinación: ${TUNINGS[tuningSel.value].label}` +
    `${k ? `\nCapo en el traste ${k} (los trastes y acordes son relativos al capo)` : ''}\nGenerado con GuitarrIA\n\n`;
  download(`${state.name}.txt`, header + toAsciiTab(state.events, tuning, 72, names), 'text/plain');
});
$('expMid').addEventListener('click', () => {
  const midi = new Midi();
  midi.header.name = state.name;
  const track = midi.addTrack();
  track.name = currentInstrument().name;
  track.instrument.number = currentInstrument().gm;
  for (const n of state.notes) track.addNote({ midi: n.midi, time: n.start, duration: n.duration, velocity: Math.min(1, n.velocity) });
  download(`${state.name}.mid`, new Uint8Array(midi.toArray()), 'audio/midi');
});
$('expJson').addEventListener('click', () => {
  const data = {
    app: 'GuitarrIA',
    version: 3,
    name: state.name,
    tuning: tuningSel.value,
    capo: capo(),
    mode: modeSel.value,
    notes: state.notes,
    chords: state.chords.filter((c) => c.root >= 0),
    // Desde la versión 3: la digitación (con las correcciones a mano) y el ritmo.
    events: state.events,
    rhythm: state.rhythm,
    rhythmLocked: state.rhythmLocked,
  };
  download(`${state.name}.json`, JSON.stringify(data), 'application/json');
});

const impInput = $<HTMLInputElement>('impJson');
$('impBtn').addEventListener('click', () => impInput.click());
impInput.addEventListener('change', async () => {
  const f = impInput.files?.[0];
  impInput.value = '';
  if (!f) return;
  showError(null);
  try {
    const data = JSON.parse(await f.text());
    const ok = (n: Note) =>
      n && [n.start, n.duration, n.midi, n.velocity].every((x) => typeof x === 'number' && Number.isFinite(x)) && n.midi >= 0 && n.midi < 128;
    if (!Array.isArray(data?.notes) || !data.notes.every(ok)) throw new Error('formato');
    generation++;
    setBusy(false);
    player.pause();
    dropYouTube();
    ytId = null;
    $('ytPanel').hidden = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    audioEl.removeAttribute('src');
    audioEl.load();
    state.name = safeFileName(String(data.name ?? 'cancion'));
    state.prepared = null;
    state.buffer = null;
    state.offset = 0;
    state.notes = data.notes.map((n: Note) => ({ start: n.start, duration: n.duration, midi: n.midi, velocity: n.velocity }));
    if (TUNINGS[data.tuning]) fillTunings(TUNINGS[data.tuning].instrument, data.tuning);
    resetEditing();
    if (data.mode === 'lead' || data.mode === 'chords') modeSel.value = data.mode;
    capoInput.value = String(Math.max(0, Math.min(12, Math.round(Number(data.capo) || 0))));
    $('tuneInfo').textContent = 'Proyecto abierto (sin audio: usa el sintetizado para escucharlo)';
    // Sin audio original: el sintetizado se pone a tope para poder escuchar algo.
    $<HTMLInputElement>('volSynth').value = '0.8';
    audioCtx();
    synthOut!.gain.value = 0.8;
    // Los acordes guardados en el proyecto salen del audio original: mejor que recalcularlos con las notas.
    const okChord = (c: ChordSegment) =>
      c && [c.start, c.end, c.root, c.bass].every((x) => typeof x === 'number' && Number.isFinite(x)) && typeof c.quality === 'string';
    if (Array.isArray(data.chords) && data.chords.every(okChord)) {
      state.chords = data.chords.map((c: ChordSegment) => ({ ...c, name: chordName(c.root, c.quality, c.bass) }));
      renderChordList();
      state.chordShown = undefined;
    } else refreshChords();
    const end = Math.max(1, ...state.notes.map((n) => n.start + n.duration)) + 0.5;
    player = new ClockPlayer(end);
    showPaused(player);
    setRate(state.rate);
    playBtn.textContent = '▶';
    workspace.hidden = false;
    const okEvent = (e: Event) =>
      e && Number.isFinite(e.start) && Number.isFinite(e.end) && Array.isArray(e.notes) && e.notes.length > 0 &&
      e.notes.every((n) => ok(n) && Number.isInteger(n.string) && n.string >= 0 && n.string < currentTuning().length && Number.isInteger(n.fret) && n.fret >= 0 && n.fret <= 30);
    const okRhythm = (r: Rhythm) =>
      r && Array.isArray(r.beats) && r.beats.length >= 2 && r.beats.every(Number.isFinite) && [2, 3, 4, 6].includes(r.beatsPerBar) &&
      [4, 8].includes(r.beatUnit) && Number.isInteger(r.firstBar) && r.firstBar >= 0 && r.firstBar < r.beats.length && Number.isInteger(r.key) && Math.abs(r.key) <= 7;
    if (okRhythm(data.rhythm)) {
      state.rhythm = { ...data.rhythm, bpm: Number(data.rhythm.bpm) || 120, minor: !!data.rhythm.minor };
      state.rhythmLocked = !!data.rhythmLocked;
    }
    if (Array.isArray(data.events) && data.events.length && data.events.every(okEvent)) {
      setEvents(cloneEvents(data.events), !state.rhythm);
      state.notes = notesFromEvents(state.events);
    } else refreshFingering();
    resetLoop();
    seek(0);
  } catch {
    showError('Ese archivo no es un proyecto de GuitarrIA válido.');
  }
});

// ---------- Ritmo: tempo, compás y tonalidad ----------
const bpmInput = $<HTMLInputElement>('bpm');
const meterSel = $<HTMLSelectElement>('meter');
const keySel = $<HTMLSelectElement>('keySel');

/** Tónica de una armadura: Sol mayor (1♯), Mi menor (1♯)… con la notación elegida. */
function keyText(key: number, minor: boolean): string {
  const pc = (((key * 7 + (minor ? 9 : 0)) % 12) + 12) % 12;
  const latin = notationSel.value.startsWith('latin');
  const n: Notation = latin ? (key < 0 ? 'latinFlat' : 'latin') : key < 0 ? 'flat' : 'sharp';
  const acc = key === 0 ? '' : ` · ${Math.abs(key)}${key > 0 ? '♯' : '♭'}`;
  return `${pcName(pc, n)} ${minor ? 'menor' : 'mayor'}${acc}`;
}
function fillKeys() {
  const v = keySel.value;
  keySel.innerHTML = '';
  for (const minor of [false, true]) for (let k = -7; k <= 7; k++) keySel.add(new Option(keyText(k, minor), `${k}:${minor ? 'm' : 'M'}`));
  if (v) keySel.value = v;
}
fillKeys();
notationSel.addEventListener('change', () => {
  fillKeys();
  renderSheet();
});

const songLength = () => Math.max(player.duration || 0, ...state.events.map((e) => e.end)) + 1;

function refreshRhythm(detect: boolean) {
  if (!state.events.length) {
    state.rhythm = null;
    state.q = [];
    state.bars = [];
    renderRhythmBar();
    return;
  }
  if (detect || !state.rhythm) {
    const chords = state.chords.filter((c) => c.root >= 0);
    // Para la tonalidad cuentan las notas y también los acordes (raíz, tercera y quinta).
    const chordTones = chords.flatMap((c) => {
      const minor = c.quality.startsWith('m') && !c.quality.startsWith('maj');
      const third = minor || c.quality.startsWith('dim') ? 3 : c.quality.startsWith('sus') || c.quality === '5' ? 7 : 4;
      return [0, third, 7].map((iv, k) => ({ midi: 48 + ((c.root + iv) % 12), duration: (c.end - c.start) * (k ? 0.6 : 1), velocity: 0.8 }));
    });
    state.rhythm = analyzeRhythm(state.events, chords.map((c) => c.start), [...state.notes, ...chordTones]);
  }
  requantize();
}

/** Recalcula la cuadrícula y los compases con el ritmo actual (sin volver a detectarlo). */
function requantize() {
  const r = state.rhythm;
  if (!r) return;
  state.q = quantize(state.events, r);
  state.bars = buildBars(state.events, state.q, r, state.chords);
  renderRhythmBar();
  renderSheet();
}

let rhythmMsgTimer = 0;
function flashRhythm(msg: string) {
  $('rhythmInfo').textContent = msg;
  clearTimeout(rhythmMsgTimer);
  rhythmMsgTimer = window.setTimeout(renderRhythmBar, 4000);
}

function renderRhythmBar() {
  const r = state.rhythm;
  bpmInput.value = r ? String(Math.round(r.bpm)) : '';
  meterSel.value = r ? `${r.beatsPerBar}/${r.beatUnit}` : '4/4';
  if (r) keySel.value = `${r.key}:${r.minor ? 'm' : 'M'}`;
  $('rhythmInfo').textContent = r ? `${state.bars.length} compases${state.rhythmLocked ? '' : ' · detectado automáticamente'}` : '';
}

/** Cambia el ritmo a mano (se puede deshacer y ya no se vuelve a detectar solo). */
function changeRhythm(f: (r: Rhythm) => Rhythm) {
  if (!state.rhythm) return;
  history.push(snapshot());
  state.rhythm = f(state.rhythm);
  state.rhythmLocked = true;
  requantize();
  updateEditor();
}
const clampBpm = (v: number) => Math.max(30, Math.min(300, v));
bpmInput.addEventListener('change', () => {
  const v = Number(bpmInput.value);
  if (!Number.isFinite(v) || v <= 0) return renderRhythmBar();
  changeRhythm((r) => withTempo(r, clampBpm(v), songLength()));
});
$('bpmHalf').addEventListener('click', () => changeRhythm((r) => withTempo(r, clampBpm(r.bpm / 2), songLength())));
$('bpmDouble').addEventListener('click', () => changeRhythm((r) => withTempo(r, clampBpm(r.bpm * 2), songLength())));
meterSel.addEventListener('change', () => {
  const [n, d] = meterSel.value.split('/').map(Number);
  changeRhythm((r) => ({ ...r, beatsPerBar: n, beatUnit: d as 4 | 8 }));
});
keySel.addEventListener('change', () => {
  const [k, m] = keySel.value.split(':');
  changeRhythm((r) => ({ ...r, key: Number(k), minor: m === 'm' }));
});
$('rhythmAuto').addEventListener('click', () => {
  if (!state.events.length) return;
  history.push(snapshot());
  state.rhythmLocked = false;
  refreshRhythm(true);
  updateEditor();
});

// Marcar el pulso: con la canción sonando, cada pulsación cae en un tiempo; la primera es el primer tiempo del compás.
let taps: number[] = [];
function tap() {
  const t = player.paused ? performance.now() / 1000 : player.time;
  if (taps.length && (t - taps[taps.length - 1] > 2.5 || t <= taps[taps.length - 1])) taps = [];
  taps.push(t);
  if (taps.length < 4) {
    flashRhythm(`Sigue marcando el pulso… (${taps.length}/4)`);
    return;
  }
  const period = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  const bpm = clampBpm(60 / period);
  const anchor = player.paused ? undefined : taps[0];
  if (taps.length === 4) history.push(snapshot());
  state.rhythm = withTempo(state.rhythm!, bpm, songLength(), anchor);
  state.rhythmLocked = true;
  requantize();
  flashRhythm(`Tempo marcado: ${Math.round(bpm)} BPM${anchor !== undefined ? ' (el primer toque es el primer tiempo)' : ''}`);
}
$('tap').addEventListener('click', () => state.rhythm && tap());

// ---------- Partitura ----------
type SheetMode = 'quick' | SheetProfile;
const sheetEl = $('sheet');
const sheetMsg = $('sheetMsg');
let sheet: SheetView | null = null;
let sheetMode: SheetMode = 'quick';
let sheetTimer = 0;

/** XML de la partitura. Para la vista previa (alphaTab) el pentagrama declara tantas líneas como cuerdas. */
function currentXml(preview = false): string {
  const ins = currentInstrument();
  return toMusicXml(state.bars, state.rhythm!, {
    title: state.name,
    tuning: currentTuning(),
    capo: capo(),
    instrument: { name: ins.name, program: ins.gm + 1, clef: ins.clef },
    staffLines: preview ? currentTuning().length : undefined,
  });
}

function renderSheet() {
  if (sheetMode === 'quick' || !state.rhythm || !state.bars.length) return;
  clearTimeout(sheetTimer);
  // Varias ediciones seguidas: se dibuja una sola vez.
  sheetTimer = window.setTimeout(() => {
    if (sheetMode === 'quick' || !state.rhythm) return;
    sheet ??= new SheetView(sheetEl, (i) => pickEvent(i));
    sheet.onRendered = () => {
      sheetMsg.hidden = true;
      sheet!.select(editInput.checked ? state.selected : -1);
    };
    sheet.render(currentXml(true), currentTuning(), capo(), sheetMode).catch((err) => {
      console.error(err);
      sheetMsg.hidden = false;
      sheetMsg.textContent = 'No se pudo dibujar la partitura. Prueba la tab rápida.';
    });
  }, 60);
}

function setSheetMode(mode: SheetMode) {
  sheetMode = mode;
  store.set('sheet', mode);
  document.querySelectorAll<HTMLButtonElement>('.seg[data-sheet]').forEach((b) => {
    b.classList.toggle('on', b.dataset.sheet === mode);
    b.setAttribute('aria-pressed', String(b.dataset.sheet === mode));
  });
  tabEl.hidden = mode !== 'quick';
  sheetEl.hidden = mode === 'quick';
  if (mode !== 'quick') {
    if (!sheet?.score) sheetMsg.hidden = false;
    renderSheet();
  }
}
document.querySelectorAll<HTMLButtonElement>('.seg[data-sheet]').forEach((b) => b.addEventListener('click', () => setSheetMode(b.dataset.sheet as SheetMode)));
setSheetMode((['quick', 'scoretab', 'score', 'tab'] as const).find((m) => m === store.get('sheet')) ?? 'quick');

// ---------- Editor ----------
type Snapshot = { events: Event[]; rhythm: Rhythm | null; locked: boolean };
const history = new History<Snapshot>();
const snapshot = (): Snapshot => ({
  events: cloneEvents(state.events),
  rhythm: state.rhythm && { ...state.rhythm, beats: [...state.rhythm.beats] },
  locked: state.rhythmLocked,
});
const editInput = $<HTMLInputElement>('editMode');
const editorEl = $('editor');
const edDur = $<HTMLSelectElement>('edDur');

function resetEditing() {
  history.clear();
  state.edited = false;
  state.rhythmLocked = false;
  state.rhythm = null;
  state.selected = -1;
  updateUndo();
}

/** Clic en una nota (tab o partitura): salta a ella y, editando, la elige. */
function pickEvent(i: number, lead = 0.05) {
  const ev = state.events[i];
  if (!ev) return;
  seek(ev.start - lead);
  if (editInput.checked) selectEvent(i);
}

function selectEvent(i: number) {
  state.selected = i;
  tabEl.querySelector('.col.sel')?.classList.remove('sel');
  if (editInput.checked && i >= 0) tabEl.querySelector(`.col[data-i="${i}"]`)?.classList.add('sel');
  sheet?.select(editInput.checked ? i : -1);
  updateEditor();
}

function updateUndo() {
  ($('undo') as HTMLButtonElement).disabled = !history.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !history.canRedo;
}

function updateEditor() {
  updateUndo();
  if (!editInput.checked) return;
  const i = state.selected;
  const ev = state.events[i];
  const tuning = currentTuning();
  const labels = stringLabels(tuning);
  const disabled = !ev;
  for (const id of ['edDur', 'edLeft', 'edRight', 'edHear', 'edAdd', 'edDel']) ($(id) as HTMLButtonElement).disabled = disabled;
  const qi = state.q.find((x) => x.index === i);
  if (!ev || !qi || !state.rhythm) {
    $('edInfo').textContent = 'Elige una nota en la tab o la partitura';
    $('edFrets').innerHTML = '';
    return;
  }
  const bt = state.rhythm.beatUnit === 8 ? (state.rhythm.beatsPerBar * TPQ) / 2 : state.rhythm.beatsPerBar * TPQ;
  const bar = Math.floor(qi.tick / bt) + 1;
  const beat = ((qi.tick % bt) / TPQ + 1).toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
  const names = ev.notes.map((n) => noteName(n.midi, true)).join(' + ');
  $('edInfo').textContent = `Nota ${i + 1} de ${state.events.length} · compás ${bar}, tiempo ${beat} · ${formatTime(ev.start, true)} · ${names}`;
  $('edFrets').innerHTML = tuning
    .map((_, s) => s)
    .reverse()
    .map((s) => {
      const n = ev.notes.find((x) => x.string === s);
      return `<label class="ed-fret"><span>${labels[s]}</span><input type="number" min="0" max="${currentInstrument().maxFret}" step="1" inputmode="numeric" data-s="${s}" value="${n ? n.fret : ''}" aria-label="Cuerda ${tuning.length - s}" /></label>`;
    })
    .join('');
  const options = [...edDur.options].map((o) => Number(o.value));
  edDur.value = String(options.reduce((best, v) => (Math.abs(v - qi.dur) < Math.abs(best - qi.dur) ? v : best), options[0]));
}

/** Aplica una edición: guarda el estado anterior para deshacer y lo redibuja todo. */
function applyEdit(events: Event[], select = state.selected) {
  history.push(snapshot());
  state.edited = true;
  commitEvents(events, select);
}
function commitEvents(events: Event[], select: number) {
  state.events = events;
  state.notes = notesFromEvents(events);
  mapChordStarts();
  state.current = -1;
  state.dirty = true;
  renderTab();
  requantize();
  selectEvent(Math.max(-1, Math.min(select, state.events.length - 1)));
}

function restore(s: Snapshot | null) {
  if (!s) return;
  state.rhythm = s.rhythm;
  state.rhythmLocked = s.locked;
  state.edited = true;
  commitEvents(s.events, state.selected);
  updateUndo();
}
$('undo').addEventListener('click', () => restore(history.undo(snapshot())));
$('redo').addEventListener('click', () => restore(history.redo(snapshot())));

editInput.addEventListener('change', () => {
  editorEl.hidden = !editInput.checked;
  tabEl.classList.toggle('editing', editInput.checked);
  if (editInput.checked && state.selected < 0) state.selected = Math.max(0, state.current);
  selectEvent(editInput.checked ? state.selected : state.selected);
  if (!editInput.checked) tabEl.querySelector('.col.sel')?.classList.remove('sel');
});

$('edFrets').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.dataset.s || state.selected < 0) return;
  const raw = input.value.trim();
  const fret = raw === '' ? null : Math.round(Number(raw));
  if (fret !== null && (!Number.isFinite(fret) || fret < 0 || fret > currentInstrument().maxFret)) {
    updateEditor();
    return;
  }
  const before = state.events.length;
  const next = setFret(state.events, state.selected, Number(input.dataset.s), fret, currentTuning(), capo());
  applyEdit(next, next.length < before ? state.selected - 1 : state.selected);
  hear();
  // Sigue en la misma cuerda para escribir varias seguidas.
  $('edFrets').querySelector<HTMLInputElement>(`input[data-s="${input.dataset.s}"]`)?.focus();
});
edDur.addEventListener('change', () => {
  if (state.selected >= 0 && state.rhythm) applyEdit(setDuration(state.events, state.q, state.rhythm, state.selected, Number(edDur.value)));
});
$('edLeft').addEventListener('click', () => state.rhythm && applyEdit(moveEvent(state.events, state.q, state.rhythm, state.selected, -1)));
$('edRight').addEventListener('click', () => state.rhythm && applyEdit(moveEvent(state.events, state.q, state.rhythm, state.selected, 1)));
$('edAdd').addEventListener('click', () => {
  if (state.selected < 0 || !state.rhythm) return;
  const r = insertAfter(state.events, state.q, state.rhythm, state.selected);
  if (r.index === state.selected) return flashRhythm('No hay sitio: acorta la nota o muévela antes de añadir otra');
  applyEdit(r.events, r.index);
});
$('edDel').addEventListener('click', () => state.selected >= 0 && applyEdit(deleteEvent(state.events, state.selected), state.selected));
$('edHear').addEventListener('click', () => hear());
function hear() {
  const ev = state.events[state.selected];
  if (!ev) return;
  const ac = audioCtx();
  ac.resume();
  const out = ac.createGain();
  out.gain.value = 0.8;
  out.connect(ac.destination);
  ev.notes.forEach((n) => pluck(ac, out, n.midi, Math.min(1.5, Math.max(0.3, ev.end - ev.start)), 0.8));
}

// Atajos de edición (fuera de los campos de texto).
document.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if ($('view-transcribe').hidden || workspace.hidden || el.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    $('undo').click();
  } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault();
    $('redo').click();
  } else if (!mod && (e.key === 't' || e.key === 'T') && state.rhythm) tap();
  else if (editInput.checked && !mod && state.selected >= 0) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      $('edDel').click();
    } else if (e.key === 'Insert') $('edAdd').click();
    else if (e.key === 'h' || e.key === 'H') hear();
  }
});

// ---------- Exportar partitura ----------
function needScore(): boolean {
  if (state.rhythm && state.bars.length) return true;
  showError('Primero transcribe una canción.');
  return false;
}
$('expXml').addEventListener('click', () => {
  if (needScore()) download(`${state.name}.musicxml`, currentXml(), 'application/vnd.recordare.musicxml+xml');
});
$('expGp').addEventListener('click', async () => {
  if (!needScore()) return;
  try {
    download(`${state.name}.gp`, new Uint8Array(await musicXmlToGp(currentXml(true), currentTuning(), capo())), 'application/octet-stream');
  } catch (err) {
    console.error(err);
    showError('No se pudo crear el archivo de Guitar Pro.');
  }
});
$('expPdf').addEventListener('click', async () => {
  if (!needScore()) return;
  if (sheetMode === 'quick') setSheetMode('scoretab');
  // Espera a que la partitura esté dibujada (como mucho 15 s).
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 100));
  while ((!sheet?.score || sheet.rendering) && performance.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
  sheet?.print();
});
$('expMidQ').addEventListener('click', () => {
  if (!needScore()) return;
  const r = state.rhythm!;
  const midi = new Midi();
  midi.header.name = state.name;
  midi.header.setTempo(r.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [r.beatsPerBar, r.beatUnit] });
  // @tonejs/midi guarda la armadura por el nombre de la mayor con esas alteraciones.
  const KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  midi.header.keySignatures.push({ ticks: 0, key: KEYS[r.key + 7], scale: r.minor ? 'minor' : 'major' });
  midi.header.update();
  const track = midi.addTrack();
  track.name = currentInstrument().name;
  track.instrument.number = currentInstrument().gm;
  const ppq = midi.header.ppq;
  for (const x of state.q)
    for (const n of state.events[x.index].notes)
      track.addNote({ midi: n.midi, ticks: (x.tick * ppq) / TPQ, durationTicks: (x.dur * ppq) / TPQ, velocity: Math.min(1, n.velocity) });
  download(`${state.name}-cuantizado.mid`, new Uint8Array(midi.toArray()), 'audio/midi');
});

// ---------- Afinador ----------
const tunerTuning = $<HTMLSelectElement>('tunerTuning');
const a4Input = $<HTMLInputElement>('a4');
const tunerNote = $('tunerNote');
const tunerCents = $('tunerCents');
const needle = $('needle');
const tunerInfo = $('tunerInfo');
const tunerBtn = $<HTMLButtonElement>('tunerStart');
tunerTuning.value = store.get('tunerTuning') ?? 'standard';
a4Input.value = store.get('a4') ?? '440';
let lockedString: number | null = null;
let tuner: Tuner | null = null;

const tunerStrings = () => TUNINGS[tunerTuning.value].strings;
const a4 = () => {
  const v = Number(a4Input.value);
  return Number.isFinite(v) && v >= 415 && v <= 466 ? v : 440;
};
function tunerOptions() {
  const strings = tunerStrings();
  return { a4: a4(), strings, lockedString, minHz: Math.min(...strings) < 36 ? 35 : 60 };
}

function renderTunerStrings() {
  const strings = tunerStrings();
  $('tunerStrings').innerHTML =
    `<button class="btn small string-btn${lockedString === null ? ' on' : ''}" data-s="auto" aria-pressed="${lockedString === null}">Auto</button>` +
    strings
      .map(
        (m, i) =>
          `<button class="btn small string-btn${lockedString === i ? ' on' : ''}" data-s="${i}" aria-pressed="${lockedString === i}" title="Cuerda ${strings.length - i}: pulsa para fijarla y oír la nota">` +
          `<small>${strings.length - i}ª</small> ${noteName(m, true)}</button>`,
      )
      .join('');
}

$('tunerStrings').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.string-btn');
  if (!btn) return;
  lockedString = btn.dataset.s === 'auto' ? null : Number(btn.dataset.s);
  if (tuner) tuner.opts = tunerOptions();
  renderTunerStrings();
  // Nota de referencia para afinar de oído.
  if (lockedString !== null) {
    const ac = audioCtx();
    ac.resume();
    const out = ac.createGain();
    out.gain.value = 0.9;
    out.connect(ac.destination);
    pluck(ac, out, tunerStrings()[lockedString] + 12 * Math.log2(a4() / 440), 1.6, 0.8);
  }
});
tunerTuning.addEventListener('change', () => {
  store.set('tunerTuning', tunerTuning.value);
  lockedString = null;
  if (tuner) tuner.opts = tunerOptions();
  renderTunerStrings();
});
a4Input.addEventListener('change', () => {
  a4Input.value = String(a4());
  store.set('a4', a4Input.value);
  if (tuner) tuner.opts = tunerOptions();
});
renderTunerStrings();

function showReading(r: TunerReading | null, level: number) {
  if (!r) {
    tunerNote.textContent = '–';
    tunerNote.className = 'tuner-note idle';
    tunerCents.innerHTML = '&nbsp;';
    needle.style.left = '50%';
    needle.classList.add('idle');
    tunerInfo.textContent = tuner?.running ? (level > 0.01 ? 'Escuchando… toca una sola cuerda' : 'Toca una cuerda al aire') : 'Pulsa empezar y toca una cuerda al aire';
    document.querySelectorAll('.string-btn.heard').forEach((b) => b.classList.remove('heard'));
    return;
  }
  const cents = Math.round(r.cents);
  const ok = Math.abs(cents) <= 3;
  const near = Math.abs(cents) <= 10;
  tunerNote.textContent = noteName(r.target ?? r.nearest, true);
  tunerNote.className = `tuner-note${ok ? ' ok' : near ? ' near' : ''}`;
  tunerCents.textContent = `${cents > 0 ? '+' : ''}${cents} cents`;
  needle.classList.remove('idle');
  needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  const far = Math.abs(cents) > 50;
  const what = r.target !== null && r.target !== r.nearest && far ? ` (suena ${noteName(r.nearest, true)})` : '';
  tunerInfo.textContent = `${r.freq.toFixed(1)} Hz${what} · ${ok ? '¡Afinada!' : cents > 0 ? 'aflójala un poco ↓' : 'apriétala un poco ↑'}`;
  const idx = r.target === null ? -1 : tunerStrings().indexOf(r.target);
  document.querySelectorAll<HTMLElement>('.string-btn').forEach((b) => b.classList.toggle('heard', Number(b.dataset.s) === idx && b.dataset.s !== 'auto'));
}

async function startTuner() {
  tuner ??= new Tuner(audioCtx(), tunerOptions(), showReading);
  tuner.opts = tunerOptions();
  try {
    await tuner.start();
    tunerBtn.textContent = '■ Parar afinador';
    showReading(null, 0);
  } catch (err) {
    tunerInfo.textContent = micError(err);
  }
}
function stopTuner() {
  if (!tuner?.running) return;
  tuner.stop();
  tunerBtn.textContent = '🎤 Empezar afinador';
  showReading(null, 0);
}
tunerBtn.addEventListener('click', () => (tuner?.running ? stopTuner() : startTuner()));
document.addEventListener('visibilitychange', () => document.hidden && stopTuner());

// Para las pruebas automáticas (scripts/e2e.cjs).
declare global {
  interface Window {
    __guitarria?: unknown;
  }
}
window.__guitarria = { state, get player() { return player; } };
