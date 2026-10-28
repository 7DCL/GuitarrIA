import { Midi } from '@tonejs/midi';
import { assignFingering, type Event, type Note } from './fingering';
import { drawFretboard } from './fretboard';
import { detectPitch } from './pitch';
import { pluck, renderDemo } from './synth';
import { stringLabels, toAsciiTab } from './tab';
import { detectChord, freqToMidi, noteName, TUNINGS } from './theory';
import { extractNotes, runModel, type RawOutput } from './transcribe';
import { encodeWav, download, formatTime } from './util';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const audio = $<HTMLAudioElement>('audio');
const canvas = $<HTMLCanvasElement>('fretboard');
const tabEl = $('tab');
const tuningSel = $<HTMLSelectElement>('tuning');
const capoInput = $<HTMLInputElement>('capo');
const sensInput = $<HTMLInputElement>('sens');
const namesInput = $<HTMLInputElement>('names');

const state = {
  name: 'cancion',
  raw: null as RawOutput | null,
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

async function loadBlob(blob: Blob, name: string) {
  state.name = name.replace(/\.[^.]+$/, '') || 'cancion';
  const progress = $('progress');
  const bar = progress.querySelector('div')!;
  const label = progress.querySelector('span')!;
  progress.hidden = false;
  bar.style.width = '0%';
  label.textContent = 'Decodificando audio…';
  try {
    const buffer = await audioCtx().decodeAudioData(await blob.arrayBuffer());
    audio.src = URL.createObjectURL(blob);
    label.textContent = 'La IA está escuchando… (la primera vez descarga el modelo)';
    state.raw = await runModel(buffer, (p) => {
      bar.style.width = `${Math.round(p * 100)}%`;
      label.textContent = `Transcribiendo… ${Math.round(p * 100)}%`;
    });
    refreshNotes();
    progress.hidden = true;
    $('workspace').hidden = false;
    resetLoop();
  } catch (err) {
    console.error(err);
    label.textContent = 'No se pudo procesar este archivo. Prueba con mp3 o wav.';
  }
}

// ---------- Transcripción → digitación ----------
function refreshNotes() {
  if (!state.raw) return;
  const sens = Number(sensInput.value);
  state.notes = extractNotes(state.raw, { onsetThreshold: 1 - sens, frameThreshold: 0.45 - sens * 0.3 });
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

// ---------- Reproductor ----------
const playBtn = $('play');
const seekInput = $<HTMLInputElement>('seek');
const rateSel = $<HTMLSelectElement>('rate');
const rampInput = $<HTMLInputElement>('ramp');

playBtn.addEventListener('click', () => {
  audioCtx().resume();
  if (audio.paused) audio.play();
  else audio.pause();
});
audio.addEventListener('play', () => (playBtn.textContent = '❚❚'));
audio.addEventListener('pause', () => (playBtn.textContent = '▶'));
audio.addEventListener('loadedmetadata', () => (seekInput.max = String(audio.duration)));
seekInput.addEventListener('input', () => seek(Number(seekInput.value)));
rateSel.addEventListener('change', () => (audio.playbackRate = Number(rateSel.value)));
$<HTMLInputElement>('volAudio').addEventListener('input', (e) => (audio.volume = Number((e.target as HTMLInputElement).value)));
$<HTMLInputElement>('volSynth').addEventListener('input', (e) => {
  audioCtx();
  synthOut!.gain.value = Number((e.target as HTMLInputElement).value);
});

function seek(t: number) {
  audio.currentTime = Math.max(0, t);
  state.lastTime = audio.currentTime;
}

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === 'ArrowLeft') seek(audio.currentTime - 2);
  else if (e.key === 'ArrowRight') seek(audio.currentTime + 2);
});

// ---------- Bucle A-B ----------
$('loopA').addEventListener('click', () => {
  state.loopA = audio.currentTime;
  if (state.loopB !== null && state.loopB <= state.loopA) state.loopB = null;
  markLoop();
});
$('loopB').addEventListener('click', () => {
  if (state.loopA === null) state.loopA = 0;
  if (audio.currentTime > state.loopA) state.loopB = audio.currentTime;
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
    a !== null && b !== null ? `Bucle ${formatTime(a)} → ${formatTime(b)} · ${Math.round(audio.playbackRate * 100)}%` : '';
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
  let t = audio.currentTime;
  if (state.loopA !== null && state.loopB !== null && t >= state.loopB) {
    seek(state.loopA);
    t = state.loopA;
    if (rampInput.checked && audio.playbackRate < 1) {
      audio.playbackRate = Math.min(1, +(audio.playbackRate + 0.05).toFixed(2));
      markLoop();
    }
  }

  if (!audio.paused && synthOut && synthOut.gain.value > 0 && ctx) {
    for (let i = Math.max(0, eventIndexAt(state.lastTime)); i < state.events.length; i++) {
      const ev = state.events[i];
      if (ev.start > t) break;
      if (ev.start > state.lastTime)
        ev.notes.forEach((n) => pluck(ctx!, synthOut!, n.midi, n.duration / audio.playbackRate, n.velocity));
    }
  }
  state.lastTime = t;

  if (!$('workspace').hidden) {
    $('clock').textContent = `${formatTime(t)} / ${formatTime(audio.duration || 0)}`;
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
    state.raw = null;
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
