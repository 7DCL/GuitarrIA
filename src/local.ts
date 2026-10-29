// Conexión con GuitarrIA Local (local/guitarria_local.py): baja el audio de YouTube en el PC del usuario.

const BASE = 'http://127.0.0.1:8765';
export const LOCAL_DOWNLOAD = 'https://github.com/7DCL/GuitarrIA/releases/download/local/GuitarrIA-Local.exe';
const OPT_IN = 'guitarria.local';

/** El usuario dijo que tiene GuitarrIA Local: solo entonces buscamos el servidor (evita avisos de red local). */
export function localOptedIn(): boolean {
  try {
    return localStorage.getItem(OPT_IN) === '1';
  } catch {
    return false;
  }
}

export function setLocalOptIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(OPT_IN, '1');
    else localStorage.removeItem(OPT_IN);
  } catch {
    /* modo privado: no se recuerda */
  }
}

export async function localAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1200) });
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

/** Baja el audio del video. `onProgress` recibe 0..1 cuando el tamaño es conocido, o -1 mientras YouTube responde. */
export async function downloadWithLocal(
  videoId: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; title: string }> {
  onProgress?.(-1);
  const res = await fetch(`${BASE}/audio?id=${encodeURIComponent(videoId)}`, { signal });
  if (!res.ok) {
    const msg = (await res.json().catch(() => null))?.error ?? `Error ${res.status}`;
    throw new Error(/confirm you.re not a bot|Sign in/i.test(msg) ? 'YouTube pidió verificación. Prueba de nuevo en unos minutos.' : msg);
  }
  const title = decodeURIComponent(res.headers.get('X-Title') ?? '') || videoId;
  const total = Number(res.headers.get('Content-Length')) || 0;
  const type = res.headers.get('Content-Type') ?? 'audio/mp4';
  if (!res.body || !total) return { blob: await res.blob(), title };
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  return { blob: new Blob(parts, { type }), title };
}
