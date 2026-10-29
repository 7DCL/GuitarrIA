"""GuitarrIA Local: pequeño servidor en tu PC que descarga el audio de YouTube para la web.

La web (https://7dcl.github.io/GuitarrIA/) no puede bajar audio de YouTube por sí sola.
Este programa lo hace desde tu conexión y se lo pasa a la web, que transcribe en tu navegador.
Solo escucha en 127.0.0.1 y solo responde a la web de GuitarrIA.

Uso: python guitarria_local.py   (o el GuitarrIA-Local.exe ya empaquetado)
"""
import json
import os
import re
import time
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import yt_dlp

VERSION = "2"
HOST, PORT = "127.0.0.1", 8765
ALLOWED_ORIGINS = {"https://7dcl.github.io"}
if os.environ.get("GUITARRIA_DEV"):
    # Solo para desarrollar la web en este PC.
    ALLOWED_ORIGINS |= {"http://localhost:5173", "http://localhost:4173"}
CACHE = Path(tempfile.gettempdir()) / "guitarria-local"
MAX_SECONDS = 20 * 60
CACHE_KEEP = 20  # audios guardados como máximo (los más viejos se borran)
VIDEO_ID = re.compile(r"^[\w-]{11}$")
_lock = threading.Lock()


def bundled(name):
    """Ruta a un binario incluido en el .exe (PyInstaller lo descomprime en _MEIPASS)."""
    base = getattr(sys, "_MEIPASS", None)
    if base and (Path(base) / name).exists():
        return str(Path(base) / name)
    return None


def pip_deno():
    """deno instalado con pip (yt-dlp[deno]), para usar el script sin empaquetar."""
    try:
        import deno

        return deno.find_deno_bin()
    except (ImportError, FileNotFoundError):
        return None


def ydl_options(outtmpl):
    opts = {
        # Sin ffmpeg: se baja el audio tal cual (m4a o webm), que el navegador sabe leer.
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "match_filter": yt_dlp.utils.match_filter_func(f"duration <= {MAX_SECONDS}"),
    }
    deno = bundled("deno.exe") or bundled("deno") or pip_deno() or shutil.which("deno")
    if deno:
        opts["js_runtimes"] = {"deno": {"path": deno}}
    return opts


AUDIO_EXT = (".m4a", ".webm", ".mp4", ".opus")


def cached(vid):
    for f in CACHE.glob(f"{vid}.*"):
        if f.suffix in AUDIO_EXT and f.stat().st_size > 0:
            return f
    return None


def prune():
    """Deja solo los CACHE_KEEP audios más recientes."""
    files = sorted((f for f in CACHE.glob("*") if f.is_file()), key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files[CACHE_KEEP:]:
        try:
            f.unlink()
        except OSError:
            pass


def download(vid):
    """Devuelve (ruta, título) del audio del video `vid`, usando la caché si ya se bajó."""
    if not VIDEO_ID.match(vid):
        raise ValueError("Id de video no válido")
    url = f"https://www.youtube.com/watch?v={vid}"
    CACHE.mkdir(exist_ok=True)
    titles = CACHE / "titles.json"
    with _lock:  # una descarga a la vez: yt-dlp y la caché no son seguros en paralelo
        names = json.loads(titles.read_text("utf-8")) if titles.exists() else {}
        hit = cached(vid)
        if hit and vid in names:
            os.utime(hit)
            return hit, names[vid]
        with yt_dlp.YoutubeDL(ydl_options(str(CACHE / f"{vid}.%(ext)s"))) as ydl:
            info = ydl.extract_info(url, download=True)
        hit = cached(vid)
        if not hit:
            raise RuntimeError("No se pudo descargar el audio (¿video de más de 20 minutos o privado?)")
        names[vid] = (info or {}).get("title") or vid
        titles.write_text(json.dumps(names, ensure_ascii=False), "utf-8")
        prune()
        return hit, names[vid]


MIME = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".webm": "audio/webm", ".opus": "audio/ogg"}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Expose-Headers", "X-Title")
        return origin in ALLOWED_ORIGINS

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.headers.get("Origin", "") not in ALLOWED_ORIGINS:
            return self._json(403, {"error": "Origen no permitido"})
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._json(200, {"ok": True, "version": VERSION, "yt_dlp": yt_dlp.version.__version__})
        if parsed.path == "/audio":
            vid = parse_qs(parsed.query).get("id", [""])[0]
            if not VIDEO_ID.match(vid):
                return self._json(400, {"error": "Id de video de YouTube no válido"})
            try:
                print(f"Descargando: {vid}")
                start = time.time()
                path, title = download(vid)
            except Exception as e:  # noqa: BLE001 — el mensaje se muestra al usuario en la web
                print(f"Error: {e}")
                return self._json(502, {"error": str(e).splitlines()[0][:300]})
            data = path.read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", MIME.get(path.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Title", quote(title))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                print("La web canceló la descarga.")
                return None
            print(f"Listo: {title} ({time.time() - start:.0f} s)")
            return None
        return self._json(404, {"error": "No encontrado"})

    def log_message(self, *args):
        pass


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"GuitarrIA Local ya está abierto (puerto {PORT} ocupado).")
        input("Pulsa Enter para cerrar…")
        return
    print("=" * 56)
    print("  GuitarrIA Local está funcionando.")
    print("  Deja esta ventana abierta y usa https://7dcl.github.io/GuitarrIA/")
    print("  Para cerrarlo, cierra esta ventana.")
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if os.environ.get("GUITARRIA_SELFTEST"):
        # Usado por el build: comprueba que yt-dlp y deno van dentro del .exe.
        deno = ydl_options("x").get("js_runtimes", {}).get("deno", {}).get("path")
        print(json.dumps({"ok": bool(deno), "version": VERSION, "yt_dlp": yt_dlp.version.__version__, "deno": deno}))
        sys.exit(0 if deno else 1)
    main()
