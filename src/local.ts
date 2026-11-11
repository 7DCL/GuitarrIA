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
  return (await localVersion()) > 0;
}

/** Versión de GuitarrIA Local abierto en el PC (0 si no responde). Instagram y TikTok necesitan la 3. */
export async function localVersion(): Promise<number> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1200) });
    const data = res.ok ? await res.json() : null;
    return data?.ok === true ? Number(data.version) || 1 : 0;
  } catch {
    return 0;
  }
}

export type Site = 'yt' | 'ig' | 'tt';

/** Enlace de Instagram (reel/publicación) o TikTok → sitio e id. Solo el id viaja a GuitarrIA Local. */
export function parseSocialLink(input: string): { site: 'ig' | 'tt'; id: string } | null {
  try {
    const s = input.trim();
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = url.hostname.replace(/^(www|m)\./, '');
    if (host === 'instagram.com') {
      const m = url.pathname.match(/^\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]{5,40})/);
      return m ? { site: 'ig', id: m[1] } : null;
    }
    if (host === 'tiktok.com') {
      const m = url.pathname.match(/\/(?:video|v|embed(?:\/v2)?)\/(\d{8,25})/);
      return m ? { site: 'tt', id: m[1] } : null;
    }
  } catch {
    /* no es una URL */
  }
  return null;
}

/** Baja el audio del video. `onProgress` recibe 0..1 cuando el tamaño es conocido, o -1 mientras YouTube responde. */
export async function downloadWithLocal(
  videoId: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  site: Site = 'yt',
): Promise<{ blob: Blob; title: string }> {
  onProgress?.(-1);
  const res = await fetch(`${BASE}/audio?id=${encodeURIComponent(videoId)}${site === 'yt' ? '' : `&site=${site}`}`, { signal });
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
