// Reproductores intercambiables: archivo de audio local o video de YouTube incrustado.

export interface Player {
  readonly time: number;
  readonly duration: number;
  readonly paused: boolean;
  rate: number;
  volume: number; // 0..1
  play(): void;
  pause(): void;
  seek(t: number): void;
  onStateChange(cb: (paused: boolean) => void): void;
  destroy(): void;
}

export class AudioPlayer implements Player {
  constructor(private el: HTMLAudioElement) {}
  get time() {
    return this.el.currentTime;
  }
  get duration() {
    return this.el.duration || 0;
  }
  get paused() {
    return this.el.paused;
  }
  get rate() {
    return this.el.playbackRate;
  }
  set rate(r: number) {
    this.el.playbackRate = r;
  }
  get volume() {
    return this.el.volume;
  }
  set volume(v: number) {
    this.el.volume = v;
  }
  play() {
    // play() rechaza si el navegador bloquea el audio o se interrumpe con pause(): no es un error real.
    this.el.play().catch(() => {});
  }
  pause() {
    this.el.pause();
  }
  seek(t: number) {
    this.el.currentTime = Math.max(0, Math.min(t, this.duration || t));
  }
  private handlers: [string, () => void][] = [];
  onStateChange(cb: (paused: boolean) => void) {
    const on = () => cb(false);
    const off = () => cb(true);
    this.el.addEventListener('play', on);
    this.el.addEventListener('pause', off);
    this.handlers.push(['play', on], ['pause', off]);
  }
  destroy() {
    this.el.pause();
    for (const [ev, h] of this.handlers) this.el.removeEventListener(ev, h);
    this.handlers = [];
  }
}

/** Reloj sin audio (proyectos abiertos desde .json): el tiempo avanza y suena solo el sintetizado. */
export class ClockPlayer implements Player {
  private t0 = 0;
  private wall = 0;
  private playing = false;
  private r = 1;
  volume = 1;
  private listeners: ((paused: boolean) => void)[] = [];
  constructor(public duration: number) {}
  get time() {
    const t = this.playing ? this.t0 + ((performance.now() - this.wall) / 1000) * this.r : this.t0;
    if (t >= this.duration && this.playing) {
      this.t0 = this.duration;
      this.playing = false;
      this.listeners.forEach((cb) => cb(true));
    }
    return Math.min(t, this.duration);
  }
  get paused() {
    return !this.playing;
  }
  get rate() {
    return this.r;
  }
  set rate(v: number) {
    this.t0 = this.time;
    this.wall = performance.now();
    this.r = v;
  }
  play() {
    if (this.playing) return;
    if (this.t0 >= this.duration) this.t0 = 0;
    this.wall = performance.now();
    this.playing = true;
    this.listeners.forEach((cb) => cb(false));
  }
  pause() {
    if (!this.playing) return;
    this.t0 = this.time;
    this.playing = false;
    this.listeners.forEach((cb) => cb(true));
  }
  seek(t: number) {
    this.t0 = Math.max(0, Math.min(t, this.duration));
    this.wall = performance.now();
  }
  onStateChange(cb: (paused: boolean) => void) {
    this.listeners.push(cb);
  }
  destroy() {
    this.playing = false;
    this.listeners = [];
  }
}

/** Extrae el id de un video de YouTube de cualquier formato de enlace habitual. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return url.pathname.slice(1, 12) || null;
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
    const v = url.searchParams.get('v');
    if (v) return v.slice(0, 11);
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Tipos mínimos de la IFrame API de YouTube.
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(t: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  getPlaybackRate(): number;
  setVolume(v: number): void;
  getVideoData(): { title?: string };
  getAvailablePlaybackRates?(): number[];
  destroy?(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<void> | null = null;
function loadApi(timeoutMs = 12000): Promise<void> {
  apiReady ??= new Promise<void>((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const timer = setTimeout(() => fail('YouTube no responde. Revisa tu conexión o un bloqueador de anuncios.'), timeoutMs);
    const s = document.createElement('script');
    const fail = (msg: string) => {
      clearTimeout(timer);
      s.remove();
      apiReady = null; // permite reintentar
      reject(new Error(msg));
    };
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve();
    };
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => fail('No se pudo cargar YouTube. Revisa tu conexión o un bloqueador de anuncios.');
    document.head.appendChild(s);
  });
  return apiReady;
}

const PLAYING = 1;
const ENDED = 0;
const ERRORS: Record<number, string> = {
  2: 'Enlace no válido.',
  5: 'El video no se puede reproducir aquí.',
  100: 'El video no existe o es privado.',
  101: 'El dueño del video no permite verlo fuera de YouTube.',
  150: 'El dueño del video no permite verlo fuera de YouTube.',
};

export class YouTubePlayer implements Player {
  private yt!: YTPlayer;
  private listeners: ((paused: boolean) => void)[] = [];
  private endListeners: (() => void)[] = [];
  // YouTube actualiza el tiempo a saltos: interpolamos para que la animación sea fluida.
  private lastT = 0;
  private lastWall = 0;
  private vol = 1;

  static async create(container: HTMLElement, videoId: string): Promise<YouTubePlayer> {
    await loadApi();
    const p = new YouTubePlayer();
    await new Promise<void>((resolve, reject) => {
      container.innerHTML = '<div></div>';
      p.yt = new window.YT!.Player(container.firstElementChild as HTMLElement, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => resolve(),
          onError: (e: { data: number }) => reject(new Error(ERRORS[e.data] ?? 'Error de YouTube.')),
          onStateChange: (e: { data: number }) => {
            if (p.dead) return;
            p.sync();
            p.listeners.forEach((cb) => cb(e.data !== PLAYING));
            if (e.data === ENDED) p.endListeners.forEach((cb) => cb());
          },
        },
      });
    });
    return p;
  }

  private lastReported = -1;
  private dead = false;

  private sync() {
    this.lastReported = this.yt.getCurrentTime();
    this.lastT = this.lastReported;
    this.lastWall = performance.now();
  }

  get title() {
    return this.yt.getVideoData().title || 'youtube';
  }
  get time() {
    if (this.yt.getCurrentTime() !== this.lastReported) this.sync();
    if (this.paused) return this.lastT;
    return this.lastT + ((performance.now() - this.lastWall) / 1000) * this.rate;
  }
  get duration() {
    return this.yt.getDuration() || 0;
  }
  get paused() {
    return this.yt.getPlayerState() !== PLAYING;
  }
  get rate() {
    return this.yt.getPlaybackRate();
  }
  set rate(r: number) {
    // YouTube solo admite ciertas velocidades (normalmente 0.25–2): usamos la más cercana.
    const rates = this.rates;
    this.yt.setPlaybackRate(rates.reduce((b, x) => (Math.abs(x - r) < Math.abs(b - r) ? x : b), rates[0]));
  }
  get rates(): number[] {
    const r = this.yt.getAvailablePlaybackRates?.() ?? [];
    return r.length ? r : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  }
  get volume() {
    return this.vol;
  }
  set volume(v: number) {
    this.vol = v;
    this.yt.setVolume(Math.round(v * 100));
  }
  play() {
    this.yt.playVideo();
  }
  pause() {
    this.yt.pauseVideo();
  }
  seek(t: number) {
    // YouTube tarda en reflejar el salto: fijamos el tiempo hasta que informe uno nuevo.
    this.lastReported = this.yt.getCurrentTime();
    this.yt.seekTo(Math.max(0, t), true);
    this.lastT = Math.max(0, t);
    this.lastWall = performance.now();
  }
  onStateChange(cb: (paused: boolean) => void) {
    this.listeners.push(cb);
  }
  onEnded(cb: () => void) {
    this.endListeners.push(cb);
  }
  destroy() {
    this.dead = true;
    this.listeners = [];
    this.endListeners = [];
    try {
      this.yt.destroy?.();
    } catch {
      /* el iframe ya no existe */
    }
  }
}

/**
 * Graba el audio de esta pestaña (incluido el video de YouTube incrustado).
 * Forma gratuita de obtener el audio sin servidor; solo Chrome/Edge de escritorio.
 */
export async function captureTabAudio(onEnded?: () => void): Promise<{ startedAt: number; stop: () => Promise<Blob> }> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Tu navegador no permite capturar audio. Usa Chrome o Edge en un ordenador.');
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'include',
  } as DisplayMediaStreamOptions);
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No se compartió el audio. Elige "Esta pestaña" y activa "Compartir audio de la pestaña".');
  }
  const recorder = new MediaRecorder(new MediaStream(audioTracks));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const started = new Promise<number>((resolve) => (recorder.onstart = () => resolve(performance.now())));
  // Si el usuario pulsa "Dejar de compartir" en el navegador, avisamos para terminar la grabación.
  audioTracks[0].onended = () => onEnded?.();
  recorder.start(1000);
  const blob = () => new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  return {
    startedAt: await started,
    stop: () =>
      new Promise((resolve) => {
        const done = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(blob());
        };
        if (recorder.state === 'inactive') return done();
        recorder.onstop = done;
        recorder.stop();
      }),
  };
}
