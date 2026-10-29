// Utilidades: WAV, descargas y formato de tiempo.

/** Codifica un AudioBuffer como WAV PCM de 16 bits (mono). */
export function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const data = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const text = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + data.length * 2, true);
  text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, data.length * 2, true);
  data.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return out.buffer;
}

export function download(name: string, content: BlobPart, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function formatTime(t: number, tenths = false): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t);
  const base = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((t - s) * 10)}` : base;
}

/** Nombre de archivo seguro a partir de un título (los de YouTube traen / : ? etc.). */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'cancion';
}
