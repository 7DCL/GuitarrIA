#!/usr/bin/env bash
# Descarga el audio de un video de YouTube (uso personal) para subirlo a la app.
# Requiere yt-dlp y ffmpeg (gratis): pipx install yt-dlp
# Uso: ./scripts/yt-audio.sh "https://youtube.com/watch?v=..." [salida.mp3]
set -euo pipefail
url="${1:?Uso: $0 <url> [salida.mp3]}"
out="${2:-audio.mp3}"
yt-dlp -x --audio-format mp3 -o "${out%.mp3}.%(ext)s" "$url"
echo "Listo: $out  -> súbelo en la app"
