# 🎸 GuitarrIA

Convierte cualquier grabación de guitarra en **tablatura tocable** con IA, la muestra en un
**diapasón animado** y te deja practicarla lento y en bucle. Inspirado en deepfret.com, pero
**gratis, de código abierto y 100% en tu navegador** (el audio nunca sale de tu equipo).

## Funciones
- **Pega un enlace de YouTube**: el video se ve dentro de la app y se sincroniza con la tab.
- Sube un audio, grábalo con el micrófono o prueba la demo.
- Transcripción polifónica con [Basic Pitch](https://basicpitch.io) (Spotify) ejecutado en el navegador.
- Digitación inteligente: elige cuerda y traste minimizando saltos de mano (algoritmo de Viterbi).
- Diapasón animado con notas que suenan y anillos de anticipación.
- Tab interactiva: clic en una columna para saltar; nombres de acordes detectados.
- Velocidad 25–100% sin cambiar el tono, bucle A-B y **práctica progresiva** (+5% por vuelta).
- Escucha la transcripción con un sintetizador y compárala con el original.
- Afinaciones (estándar, Drop D, Eb, DADGAD, Open G, bajo) y capo, sin volver a transcribir.
- Afinador cromático por micrófono.
- Exporta tab `.txt`, MIDI y proyecto `.json`.

## Uso
```bash
./scripts/setup.sh   # instala dependencias
./scripts/dev.sh     # http://localhost:5173
./scripts/check.sh   # tests + build (antes de cada commit)
./scripts/yt-audio.sh "<url de YouTube>"   # baja el audio para subirlo (requiere yt-dlp)
```

## Cómo funciona YouTube (gratis y sin servidor)
El video se incrusta con el reproductor oficial y GuitarrIA graba el **audio de la propia pestaña**
mientras suena (API `getDisplayMedia`), así que la transcripción tarda lo mismo que el video.
Al pulsar *Transcribir el video* elige **Esta pestaña** y activa **Compartir audio de la pestaña**.
Funciona en Chrome y Edge de escritorio. Algunos videos no permiten verse fuera de YouTube; para esos,
`scripts/yt-audio.sh` baja el mp3 para subirlo.

## Publicación gratis
Cada push a `main` publica en GitHub Pages (`.github/workflows/deploy.yml`). Activa una vez:
*Settings → Pages → Source: GitHub Actions*.

## Estructura
| Archivo | Qué hace |
|---|---|
| `src/transcribe.ts` | Audio → notas (Basic Pitch) |
| `src/fingering.ts` | Notas → cuerda/traste (Viterbi) |
| `src/tab.ts` | Tab ASCII |
| `src/fretboard.ts` | Diapasón en canvas |
| `src/theory.ts` | Notas, afinaciones, acordes |
| `src/pitch.ts` | Detector de tono (afinador) |
| `src/player.ts` | Reproductor de archivo / YouTube y captura de pestaña |
| `src/main.ts` | Interfaz |

## Próximos pasos
- Coach por micrófono que puntúa si tocas la nota correcta a tiempo.
- Separación de guitarra en mezclas completas (Demucs en WebGPU).
- Export a Guitar Pro / PDF.
