import { Midi } from '@tonejs/midi';
import type { Mode } from './cleanup';
import { assignFingering, type Event, type Note } from './fingering';
import { drawFretboard } from './fretboard';
import { detectPitch } from './pitch';
import { downloadWithLocal, localAvailable, LOCAL_DOWNLOAD } from './local';
import { AudioPlayer, YouTubePlayer, captureTabAudio, parseYouTubeId, type Player } from './player';
import { pluck, renderDemo } from './synth';
import { stringLabels, toAsciiTab } from './tab';
import { detectChord, freqToMidi, noteName, TUNINGS } from './theory';
import { analyze, toNotes, type NoiseLevel, type Prepared } from './pipeline';
import { encodeWav, download, formatTime } from './util';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const audioPlayer = new AudioPlayer($<HTMLAudioElement>('audio'));
let player: Player = audioPlayer;
let ytPlayer: YouTubePlayer | null = null;
const canvas = $<HTMLCanvasElement>('fretboard');
const tabEl = $('tab');
const tuningSel = $<HTMLSelectElement>('tuning');
const capoInput = $<HTMLInputElement>('capo');
const sensInput = $<HTMLInputElement>('sens');
const modeSel = $<HTMLSelectElement>('mode');
const noiseSel = $<HTMLSelectElement>('noise');
const namesInput = $<HTMLInputElement>('names');

const state = {
  name: 'cancion',
  buffer: null as AudioBuffer | null,
  prepared: null as Prepared | null,
  offset: 0, // segundos entre el inicio de la grabación y el segundo 0 del video
  notes: [] as Note[],
  events: [] as Event[],
  chords: [] as (string | null)[],
  frets: 15,
  loopA: null as number | null,
  loopB: null as number | null,
  lastTime: 0,
  current: -1,
};

let ctx: AudioContext | null = null;
let synthOut: GainNode | null = null;
const audioCtx = () => {
  ctx ??= new AudioContext();
  if (!synthOut) {
    synthOut = ctx.createGain();
    synthOut.connect(ctx.destination);
  }
  return ctx;
};

for (const [key, t] of Object.entries(TUNINGS)) tuningSel.add(new Option(t.label, key));

// ---------- Navegación ----------
document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll<HTMLElement>('.view').forEach((v) => (v.hidden = v.id !== `view-${btn.dataset.view}`));
  }),
);

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
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) loadBlob(f, f.name);
});
$('demo').addEventListener('click', async () => {
  const buf = await renderDemo();
  loadBlob(new Blob([encodeWav(buf)], { type: 'audio/wav' }), 'demo.wav');
});

let recorder: MediaRecorder | null = null;
$('record').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (ev) => chunks.push(ev.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      btn.textContent = '● Grabar con micrófono';
      loadBlob(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }), 'grabacion');
    };
    recorder.start();
    btn.textContent = '■ Parar y transcribir';
  } catch {
    alert('No se pudo acceder al micrófono.');
  }
});

// ---------- YouTube ----------
// Dos caminos: si GuitarrIA Local está abierto en el PC, baja el audio y transcribe al instante;
// si no, el video se incrusta y GuitarrIA graba el audio de la pestaña mientras suena.
const ytStatus = $('ytStatus');
const ytStart = $<HTMLButtonElement>('ytStart');
const ytStop = $<HTMLButtonElement>('ytStop');
let capture: { startedAt: number; stop: () => Promise<Blob> } | null = null;
let ytOffset: number | null = null;

$('ytForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = parseYouTubeId($<HTMLInputElement>('ytUrl').value);
  if (!id) {
    alert('No reconozco ese enlace de YouTube.');
    return;
  }
  if (capture) await finishCapture(false);
  player.pause();
  $('workspace').hidden = true;
  $('ytPanel').hidden = false;
  $('ytPanel').classList.add('compact');
  $('ytCapture').hidden = true;
  ytPlayer = null;
  const [hasLocal, yt] = await Promise.all([
    localAvailable(),
    YouTubePlayer.create($('ytBox'), id).catch((err: Error) => err),
  ]);
  if (yt instanceof YouTubePlayer) {
    ytPlayer = yt;
    showPaused(yt);
    yt.onEnded(() => capture && finishCapture(true));
  }

  // Con GuitarrIA Local abierto en el PC: se baja el audio y se transcribe sin reproducir nada.
  if (hasLocal) {
    const progress = $('progress');
    progress.hidden = false;
    progress.querySelector('div')!.style.width = '0%';
    progress.querySelector('span')!.textContent = 'Descargando el audio con GuitarrIA Local…';
    try {
      const { blob, title } = await downloadWithLocal(id);
      await loadBlob(blob, title, ytPlayer ?? undefined, 0);
      return;
    } catch (err) {
      progress.hidden = true;
      ytStatus.textContent = `GuitarrIA Local no pudo bajarlo: ${(err as Error).message}. Puedes transcribirlo escuchándolo:`;
    }
  } else ytStatus.textContent = '';

  if (!(yt instanceof YouTubePlayer)) {
    ytStatus.textContent = yt.message;
    $('ytCapture').hidden = false;
    ytStart.hidden = true;
    return;
  }
  ytStart.hidden = false;
  $('ytPanel').classList.remove('compact');
  $('ytCapture').hidden = false;
  $<HTMLAnchorElement>('localLink').href = LOCAL_DOWNLOAD;
  $('localTip').hidden = hasLocal;
  if (!ytStatus.textContent) ytStatus.textContent = `Dura ${formatTime(yt.duration)}: escuchándolo, la transcripción tarda lo mismo que el video.`;
});

ytStart.addEventListener('click', async () => {
  const yt = ytPlayer;
  if (!yt || capture) return;
  try {
    yt.pause();
    yt.seek(0);
    capture = await captureTabAudio();
  } catch (err) {
    ytStatus.textContent = (err as Error).name === 'NotAllowedError' ? 'Captura cancelada.' : (err as Error).message;
    return;
  }
  const cap = capture;
  // Alinear la grabación con el video: momento en que empieza a sonar de verdad.
  yt.onStateChange((paused) => {
    if (!paused && capture === cap && ytOffset === null) ytOffset = (performance.now() - cap.startedAt) / 1000 - yt.time;
  });
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
  ytPlayer?.pause();
  if (!transcribe || !ytPlayer) return;
  ytStatus.textContent = '';
  $('ytCapture').hidden = true;
  $('ytPanel').classList.add('compact');
  loadBlob(blob, ytPlayer.title, ytPlayer, ytOffset ?? 0);
}

/** Transcribe un audio. Si viene de YouTube, se reproduce con el video en vez de con el archivo. */
async function loadBlob(blob: Blob, name: string, source?: YouTubePlayer, offset = 0) {
  player.pause();
  state.offset = offset;
  state.name = name.replace(/\.[^.]+$/, '') || 'cancion';
  const progress = $('progress');
  const bar = progress.querySelector('div')!;
  const label = progress.querySelector('span')!;
  progress.hidden = false;
  bar.style.width = '0%';
  label.textContent = 'Decodificando audio…';
  try {
    const buffer = await audioCtx().decodeAudioData(await blob.arrayBuffer());
    if (source) player = source;
    else {
      $<HTMLAudioElement>('audio').src = URL.createObjectURL(blob);
      player = audioPlayer;
      $('ytPanel').hidden = true;
    }
    player.rate = Number(rateSel.value);
    state.buffer = buffer;
    await analyzeBuffer();
    progress.hidden = true;
    $('workspace').hidden = false;
    drop.classList.add('later'); // con una canción cargada, la zona de subida pasa al final
    resetLoop();
  } catch (err) {
    console.error(err);
    label.textContent = 'No se pudo procesar este archivo. Prueba con mp3 o wav.';
  }
}

/** Pasa el audio por el filtro de ruido, la corrección de afinación y la IA. */
async function analyzeBuffer() {
  if (!state.buffer) return;
  const progress = $('progress');
  const bar = progress.querySelector('div')!;
  const label = progress.querySelector('span')!;
  progress.hidden = false;
  label.textContent = 'La IA está escuchando… (la primera vez descarga el modelo)';
  state.prepared = await analyze(state.buffer, { noise: noiseSel.value as NoiseLevel, autoTune: true }, (p, what) => {
    bar.style.width = `${Math.round(p * 100)}%`;
    label.textContent = `${what}… ${Math.round(p * 100)}%`;
  });
  progress.hidden = true;
  const c = Math.round(state.prepared.cents);
  $('tuneInfo').textContent =
    state.prepared.rate !== 1 ? `Tema desafinado ${c > 0 ? '+' : ''}${c} cents: corregido` : 'Afinación del tema: La 440';
  refreshNotes();
}

// ---------- Transcripción → digitación ----------
function refreshNotes() {
  if (!state.prepared) return;
  state.notes = toNotes(state.prepared, {
    mode: modeSel.value as Mode,
    sensitivity: Number(sensInput.value),
    offset: state.offset,
  });
  refreshFingering();
}

function currentTuning() {
  return TUNINGS[tuningSel.value].strings;
}

function refreshFingering() {
  const tuning = currentTuning();
  state.events = assignFingering(state.notes, { tuning, capo: Number(capoInput.value) || 0 });
  let prev: string | null = null;
  state.chords = state.events.map((ev) => {
    const name = ev.notes.length >= 2 ? detectChord(ev.notes.map((n) => n.midi)) : null;
    const show = name && name !== prev ? name : null;
    if (name) prev = name;
    return show;
  });
  const maxFret = Math.max(0, ...state.events.flatMap((e) => e.notes.map((n) => n.fret)));
  state.frets = Math.min(22, Math.max(12, maxFret + 2));
  state.current = -1;
  renderTab();
}

function renderTab() {
  const tuning = currentTuning();
  const labels = stringLabels(tuning);
  const strings = tuning.map((_, i) => i).reverse();
  const cols: string[] = [
    `<div class="col labels"><div class="ch"></div>${strings.map((s) => `<div class="cell"><span>${labels[s]}</span></div>`).join('')}</div>`,
  ];
  state.events.forEach((ev, i) => {
    const cells = strings
      .map((s) => {
        const n = ev.notes.find((x) => x.string === s);
        return `<div class="cell">${n ? `<span>${n.fret}</span>` : ''}</div>`;
      })
      .join('');
    cols.push(`<div class="col" data-i="${i}"><div class="ch">${state.chords[i] ?? ''}</div>${cells}</div>`);
  });
  tabEl.innerHTML = cols.join('');
  markLoop();
}

tabEl.addEventListener('click', (e) => {
  const col = (e.target as HTMLElement).closest<HTMLElement>('.col[data-i]');
  if (!col) return;
  seek(state.events[Number(col.dataset.i)].start - 0.05);
});

tuningSel.addEventListener('change', refreshFingering);
capoInput.addEventListener('input', refreshFingering);
sensInput.addEventListener('change', refreshNotes);
modeSel.addEventListener('change', refreshNotes);
noiseSel.addEventListener('change', analyzeBuffer);

// ---------- Reproductor ----------
const playBtn = $('play');
const seekInput = $<HTMLInputElement>('seek');
const rateSel = $<HTMLSelectElement>('rate');
const rampInput = $<HTMLInputElement>('ramp');

playBtn.addEventListener('click', () => {
  audioCtx().resume();
  if (player.paused) player.play();
  else player.pause();
});
const showPaused = (p: Player) => p.onStateChange((paused) => p === player && (playBtn.textContent = paused ? '▶' : '❚❚'));
showPaused(audioPlayer);
seekInput.addEventListener('input', () => seek(Number(seekInput.value)));
rateSel.addEventListener('change', () => (player.rate = Number(rateSel.value)));
$<HTMLInputElement>('volAudio').addEventListener('input', (e) => (player.volume = Number((e.target as HTMLInputElement).value)));
$<HTMLInputElement>('volSynth').addEventListener('input', (e) => {
  audioCtx();
  synthOut!.gain.value = Number((e.target as HTMLInputElement).value);
});

function seek(t: number) {
  player.seek(t);
  state.lastTime = Math.max(0, t);
}

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === 'ArrowLeft') seek(player.time - 2);
  else if (e.key === 'ArrowRight') seek(player.time + 2);
});

// ---------- Bucle A-B ----------
$('loopA').addEventListener('click', () => {
  state.loopA = player.time;
  if (state.loopB !== null && state.loopB <= state.loopA) state.loopB = null;
  markLoop();
});
$('loopB').addEventListener('click', () => {
  if (state.loopA === null) state.loopA = 0;
  if (player.time > state.loopA) state.loopB = player.time;
  markLoop();
});
$('loopClear').addEventListener('click', resetLoop);

function resetLoop() {
  state.loopA = state.loopB = null;
  markLoop();
}

function markLoop() {
  const { loopA: a, loopB: b } = state;
  $('loopA').classList.toggle('on', a !== null);
  $('loopB').classList.toggle('on', b !== null);
  $('loopInfo').textContent =
    a !== null && b !== null ? `Bucle ${formatTime(a)} → ${formatTime(b)} · ${Math.round(player.rate * 100)}%` : '';
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

function frame() {
  let t = player.time;
  if (state.loopA !== null && state.loopB !== null && t >= state.loopB) {
    seek(state.loopA);
    t = state.loopA;
    if (rampInput.checked && player.rate < 1) {
      player.rate = Math.min(1, +(player.rate + 0.05).toFixed(2));
      markLoop();
    }
  }

  if (!player.paused && synthOut && synthOut.gain.value > 0 && ctx) {
    for (let i = Math.max(0, eventIndexAt(state.lastTime)); i < state.events.length; i++) {
      const ev = state.events[i];
      if (ev.start > t) break;
      if (ev.start > state.lastTime)
        ev.notes.forEach((n) => pluck(ctx!, synthOut!, n.midi, n.duration / player.rate, n.velocity));
    }
  }
  state.lastTime = t;

  if (!$('workspace').hidden) {
    $('clock').textContent = `${formatTime(t)} / ${formatTime(player.duration || 0)}`;
    seekInput.max = String(player.duration);
    seekInput.value = String(t);

    const idx = eventIndexAt(t);
    if (idx !== state.current) {
      tabEl.querySelector('.col.now')?.classList.remove('now');
      const col = tabEl.querySelector<HTMLElement>(`.col[data-i="${idx}"]`);
      if (col) {
        col.classList.add('now');
        const left = col.offsetLeft - tabEl.clientWidth / 3;
        if (Math.abs(tabEl.scrollLeft - left) > tabEl.clientWidth / 3) tabEl.scrollLeft = left;
      }
      let chord: string | null = null;
      for (let i = idx; i >= 0 && !chord; i--) chord = state.chords[i];
      $('chord').textContent = chord ?? '–';
      state.current = idx;
    }
    drawFretboard(canvas, {
      tuning: currentTuning(),
      capo: Number(capoInput.value) || 0,
      events: state.events,
      time: t,
      frets: state.frets,
      showNames: namesInput.checked,
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Exportar / importar ----------
$('expTxt').addEventListener('click', () => {
  const tuning = currentTuning();
  const capo = Number(capoInput.value) || 0;
  const header = `${state.name}\nAfinación: ${TUNINGS[tuningSel.value].label}${capo ? ` · Capo ${capo}` : ''}\nGenerado con GuitarrIA\n\n`;
  download(`${state.name}.txt`, header + toAsciiTab(state.events, tuning), 'text/plain');
});
$('expMid').addEventListener('click', () => {
  const midi = new Midi();
  const track = midi.addTrack();
  track.instrument.number = 25; // guitarra acústica (acero)
  for (const n of state.notes) track.addNote({ midi: n.midi, time: n.start, duration: n.duration, velocity: Math.min(1, n.velocity) });
  download(`${state.name}.mid`, new Uint8Array(midi.toArray()), 'audio/midi');
});
$('expJson').addEventListener('click', () => {
  const data = { version: 1, name: state.name, tuning: tuningSel.value, capo: Number(capoInput.value) || 0, notes: state.notes };
  download(`${state.name}.json`, JSON.stringify(data), 'application/json');
});
$<HTMLInputElement>('impJson').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    state.name = data.name ?? 'cancion';
    state.prepared = null;
    state.buffer = null;
    state.notes = data.notes;
    if (TUNINGS[data.tuning]) tuningSel.value = data.tuning;
    capoInput.value = String(data.capo ?? 0);
    $('workspace').hidden = false;
    refreshFingering();
  } catch {
    alert('Archivo de proyecto no válido.');
  }
});

// ---------- Afinador ----------
const tunerNote = $('tunerNote');
const needle = $('needle');
const tunerInfo = $('tunerInfo');
$('tunerStrings').innerHTML = TUNINGS.standard.strings.map((m) => `<span class="btn small">${noteName(m, true)}</span>`).join('');

let tunerRunning = false;
$('tunerStart').addEventListener('click', async (e) => {
  if (tunerRunning) return;
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    const ac = audioCtx();
    await ac.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const analyser = ac.createAnalyser();
    analyser.fftSize = 4096;
    ac.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    tunerRunning = true;
    btn.hidden = true;
    let smooth = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      const f = detectPitch(buf, ac.sampleRate);
      if (f) {
        smooth = smooth && Math.abs(f - smooth) / smooth < 0.05 ? smooth * 0.7 + f * 0.3 : f;
        const midi = freqToMidi(smooth);
        const nearest = Math.round(midi);
        const cents = Math.round((midi - nearest) * 100);
        tunerNote.textContent = noteName(nearest, true);
        tunerNote.classList.toggle('ok', Math.abs(cents) <= 5);
        needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
        tunerInfo.textContent = `${smooth.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents${Math.abs(cents) <= 5 ? ' · ¡Afinada!' : cents > 0 ? ' · baja un poco' : ' · sube un poco'}`;
      }
      requestAnimationFrame(tick);
    };
    tick();
  } catch {
    tunerInfo.textContent = 'No se pudo acceder al micrófono.';
  }
});
