# 🎸 GuitarrIA

Convierte cualquier grabación de guitarra en **tablatura tocable** con IA, la muestra en un
**diapasón animado** y te deja practicarla lento y en bucle. Inspirado en deepfret.com, pero
**gratis, de código abierto y 100% en tu navegador** (el audio nunca sale de tu equipo).

## Funciones
- **Pega un enlace de YouTube**: el video se ve dentro de la app y se sincroniza con la tab.
  Con GuitarrIA Local también **Instagram (reels) y TikTok**.
- Sube un audio, grábalo con el micrófono o prueba la demo.
- Transcripción polifónica con [Basic Pitch](https://basicpitch.io) (Spotify) ejecutado en el navegador.
- Digitación inteligente: elige cuerda y traste minimizando saltos de mano (algoritmo de Viterbi).
- Diapasón animado con notas que suenan y anillos de anticipación.
- Tab interactiva: clic en una columna para saltar; nombres de acordes detectados.
- Velocidad 25–100% sin cambiar el tono, bucle A-B y **práctica progresiva** (+5% por vuelta).
- Escucha la transcripción con un sintetizador y compárala con el original.
- Filtro de ruido y corrección automática de temas desafinados respecto a La 440.
- **Partitura + tablatura con ritmo** (figuras, silencios, ligaduras, cifrado) dibujada con
  [alphaTab](https://alphatab.net); el cursor sigue la reproducción y un clic salta a la nota.
- **Ritmo automático**: tempo, compás (4/4, 3/4…) y tonalidad; corregibles a mano (BPM, ÷2/×2,
  «Marcar pulso» al ritmo de la canción).
- **Editor**: corrige trastes y cuerdas, duración, mueve, añade y borra notas; deshacer/rehacer
  (Ctrl+Z / Ctrl+Y). Las correcciones se guardan en el proyecto.
- **Separar guitarra** en canciones completas: quita la batería y, en estéreo, lo que suena en el
  centro (voz, bajo, bombo).
- Instrumentos: **guitarra** (estándar, Drop D, Eb, un tono abajo, DADGAD, Open G/D, 7 cuerdas),
  **bajo** (4 y 5 cuerdas, Drop D) y **ukelele** (GCEA, Sol grave, barítono); capo sin volver a transcribir.
- Afinador cromático por micrófono.
- Exporta **MusicXML** (MuseScore, Sibelius, Finale, Dorico), **Guitar Pro (.gp)**, **PDF**,
  **MIDI** (exacto o cuantizado al compás), tab `.txt` y proyecto `.json`.

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
con banda, con ruido y desafinado) y mide el acierto (F1), los acordes y el **ritmo** (tempo, compás,
primer tiempo y semicorchea correcta de cada nota). Los casos `banda_*` (canción completa en estéreo)
miden cuánto ayuda «Separar guitarra». Úsalo antes de tocar la transcripción.

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
| `src/rhythm.ts` | Pulso, tempo, compás, tonalidad y cuantización |
| `src/notation.ts` | Compases, figuras y exportación a MusicXML |
| `src/sheet.ts` | Partitura + tab con alphaTab, Guitar Pro y PDF |
| `src/edit.ts` | Operaciones del editor y deshacer/rehacer |
| `src/separate.ts` | Separación de la guitarra (batería y centro estéreo) |
| `src/main.ts` | Interfaz |

## Próximos pasos
- Coach por micrófono que puntúa si tocas la nota correcta a tiempo.
- Separación de guitarra en mezclas completas (Demucs en WebGPU).
- Export a Guitar Pro / PDF.
