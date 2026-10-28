// Conexión con GuitarrIA Local (local/guitarria_local.py): baja el audio de YouTube en el PC del usuario.

const BASE = 'http://127.0.0.1:8765';
export const LOCAL_DOWNLOAD = 'https://github.com/7DCL/GuitarrIA/releases/download/local/GuitarrIA-Local.exe';

export async function localAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1200) });
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

export async function downloadWithLocal(videoId: string): Promise<{ blob: Blob; title: string }> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(`${BASE}/audio?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const msg = (await res.json().catch(() => null))?.error ?? `Error ${res.status}`;
    throw new Error(/confirm you.re not a bot|Sign in/i.test(msg) ? 'YouTube pidió verificación. Prueba de nuevo en unos minutos.' : msg);
  }
  const title = decodeURIComponent(res.headers.get('X-Title') ?? '') || videoId;
  return { blob: await res.blob(), title };
}
