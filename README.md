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
- Filtro de ruido y corrección automática de temas desafinados respecto a La 440.
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

## YouTube
Dos formas, las dos gratis:

1. **Automática con GuitarrIA Local (recomendada).** Descarga
   [GuitarrIA-Local.exe](https://github.com/7DCL/GuitarrIA/releases/download/local/GuitarrIA-Local.exe),
   ábrelo y deja la ventana abierta. Al pegar un enlace, la web le pide el audio, que se baja desde tu
   conexión, y la tab sale en segundos sin reproducir el video. Solo escucha en `127.0.0.1` y solo atiende a
   la web de GuitarrIA. Windows puede avisar de «aplicación no reconocida» (no está firmada):
   *Más información → Ejecutar de todas formas*. En Mac/Linux: `./scripts/local.sh`.
2. **Sin instalar nada.** El video se incrusta y GuitarrIA graba el audio de la pestaña mientras suena
   (Chrome/Edge de escritorio; elige *Esta pestaña* y *Compartir audio*).

## Precisión
`python3 eval/make_data.py && node scripts/eval.cjs` genera audios con notas conocidas (punteo limpio,
con banda, con ruido y desafinado) y mide el acierto (F1). Úsalo antes de tocar la transcripción.

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
