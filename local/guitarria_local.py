"""GuitarrIA Local: pequeño servidor en tu PC que descarga el audio de YouTube para la web.

La web (https://7dcl.github.io/GuitarrIA/) no puede bajar audio de YouTube por sí sola.
Este programa lo hace desde tu conexión y se lo pasa a la web, que transcribe en tu navegador.
Solo escucha en 127.0.0.1 y solo responde a la web de GuitarrIA.

Uso: python guitarria_local.py   (o el GuitarrIA-Local.exe ya empaquetado)
"""
import hashlib
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

try:  # GuitarrIA Local Pro: separación de la guitarra con Demucs
    import separate

    SEPARATE = separate.available()
except ImportError:
    SEPARATE = False

VERSION = "4"
HOST, PORT = "127.0.0.1", 8765
ALLOWED_ORIGINS = {"https://7dcl.github.io"}
if os.environ.get("GUITARRIA_DEV"):
    # Solo para desarrollar la web en este PC.
    ALLOWED_ORIGINS |= {"http://localhost:5173", "http://localhost:4173"}
CACHE = Path(tempfile.gettempdir()) / "guitarria-local"
MAX_SECONDS = 20 * 60
CACHE_KEEP = 20  # audios guardados como máximo (los más viejos se borran)
VIDEO_ID = re.compile(r"^[\w-]{11}$")
# Además de YouTube: Instagram (código de la publicación) y TikTok (número del video).
# Solo se aceptan ids: la URL la arma este programa, así la web no puede pedir otra cosa.
SITES = {
    "yt": (VIDEO_ID, "https://www.youtube.com/watch?v={}"),
    "ig": (re.compile(r"^[\w-]{5,40}$"), "https://www.instagram.com/reel/{}/"),
    "tt": (re.compile(r"^\d{8,25}$"), "https://www.tiktok.com/@/video/{}"),
}
_lock = threading.Lock()
_sep_lock = threading.Lock()  # separar usa toda la CPU: de a uno
MAX_UPLOAD = 300 * 1024 * 1024


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


def download(vid, site="yt"):
    """Devuelve (ruta, título) del audio del video `vid`, usando la caché si ya se bajó."""
    pattern, template = SITES[site]
    if not pattern.match(vid):
        raise ValueError("Id de video no válido")
    url = template.format(vid)
    vid = vid if site == "yt" else f"{site}-{vid}"  # nombre en la caché
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


MIME = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".webm": "audio/webm", ".opus": "audio/ogg", ".wav": "audio/wav"}


def separated(src, key):
    """Pista de guitarra aislada de `src` (en caché por `key`)."""
    out = CACHE / f"{key}.guitar.wav"
    with _sep_lock:
        if not out.exists() or out.stat().st_size == 0:
            print("Separando la guitarra (puede tardar 1-3 minutos)…")
            start = time.time()
            separate.guitar(src, out)
            print(f"Guitarra separada en {time.time() - start:.0f} s")
    return out


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.headers.get("Origin", "") not in ALLOWED_ORIGINS:
            return self._json(403, {"error": "Origen no permitido"})
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._json(200, {"ok": True, "version": VERSION, "yt_dlp": yt_dlp.version.__version__, "separate": SEPARATE})
        if parsed.path == "/audio":
            query = parse_qs(parsed.query)
            vid = query.get("id", [""])[0]
            site = query.get("site", ["yt"])[0]
            stem = query.get("stem", [""])[0]
            if site not in SITES or not SITES[site][0].match(vid):
                return self._json(400, {"error": "Id de video no válido"})
            try:
                print(f"Descargando: {site} {vid}")
                start = time.time()
                path, title = download(vid, site)
                if stem == "guitar" and SEPARATE:
                    path = separated(path, vid if site == "yt" else f"{site}-{vid}")
            except Exception as e:  # noqa: BLE001 — el mensaje se muestra al usuario en la web
                print(f"Error: {e}")
                return self._json(502, {"error": str(e).splitlines()[0][:300]})
            if self._send_file(path, title):
                print(f"Listo: {title} ({time.time() - start:.0f} s)")
            return None
        return self._json(404, {"error": "No encontrado"})

    def do_POST(self):
        """/separate: recibe un audio (archivo subido en la web) y devuelve solo la guitarra."""
        if self.headers.get("Origin", "") not in ALLOWED_ORIGINS:
            return self._json(403, {"error": "Origen no permitido"})
        if urlparse(self.path).path != "/separate":
            return self._json(404, {"error": "No encontrado"})
        if not SEPARATE:
            return self._json(501, {"error": "Esta versión de GuitarrIA Local no separa la guitarra (usa la versión Pro)"})
        size = int(self.headers.get("Content-Length") or 0)
        if not 0 < size <= MAX_UPLOAD:
            return self._json(413, {"error": "Audio vacío o demasiado grande"})
        data = self.rfile.read(size)
        key = "upload-" + hashlib.sha1(data).hexdigest()[:16]
        CACHE.mkdir(exist_ok=True)
        src = CACHE / f"{key}.bin"
        try:
            src.write_bytes(data)
            out = separated(src, key)
        except Exception as e:  # noqa: BLE001
            print(f"Error: {e}")
            return self._json(502, {"error": "No se pudo separar la guitarra: " + str(e).splitlines()[0][:200]})
        finally:
            src.unlink(missing_ok=True)
        prune()
        self._send_file(out, "")
        return None

    def _send_file(self, path, title):
        data = path.read_bytes()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", MIME.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Title", quote(title))
        self.end_headers()
        try:
            self.wfile.write(data)
            return True
        except (BrokenPipeError, ConnectionResetError):
            print("La web canceló la descarga.")
            return False

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
    print(f"  GuitarrIA Local{' Pro' if SEPARATE else ''} está funcionando.")
    if SEPARATE:
        print("  Separación de guitarra: activada.")
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
        if not deno:
            sys.exit(1)
        if os.environ["GUITARRIA_SELFTEST"] == "pro":
            # La versión Pro tiene que separar de verdad (modelo incluido, sin descargas).
            import numpy as np

            CACHE.mkdir(exist_ok=True)
            t = np.arange(separate.SR * 6) / separate.SR
            separate.write_wav(CACHE / "selftest.wav", 0.3 * np.sin(2 * np.pi * 196 * t) * np.exp(-(t % 1) * 3))
            secs = separate.guitar(CACHE / "selftest.wav", CACHE / "selftest.guitar.wav")
            print(json.dumps({"separate": SEPARATE, "seconds": secs}))
            sys.exit(0 if SEPARATE and secs > 5 else 1)
        sys.exit(0)
    main()
