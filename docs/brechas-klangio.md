# GuitarrIA vs Klang.io Transcription Studio (2026-11-10)

Fuente: klang.io/es/transcription-studio (precios no accesibles). Nuestra app: este repo.

## Ya tenemos (y Klang no anuncia)
Diapasón animado, bucle A-B, velocidad, práctica progresiva, afinador, acordes con diagramas, todo gratis en el navegador.

## Brechas priorizadas
| # | Brecha | Klang.io | GuitarrIA hoy | Impacto |
|---|---|---|---|---|
| 1 | Ritmo: tempo, compás, cuantización | Sí (MIDI cuantizado y sin cuantizar) | Notas en segundos, sin compases | Alto: base de todo lo demás |
| 2 | Partitura + tab con figuras rítmicas | Visor de partitura y tab | Tab ASCII | Alto |
| 3 | Editor (corregir notas, ritmo, tonalidad) | Sí, en el navegador | No | Alto: la IA nunca es 100% |
| 4 | Export MusicXML, Guitar Pro, PDF | Sí (+ LilyPond) | txt, MIDI, json | Alto |
| 5 | Aislar la guitarra en mezclas completas | Modo canción completa | ~70% con banda | Alto (calidad) |
| 6 | Más instrumentos (bajo, ukelele) | Sí, muchos | Solo guitarra | Medio |
| 7 | Links Instagram/TikTok | Sí | Solo YouTube | Bajo |
| 8 | App móvil para grabar | iOS/Android | Web (micrófono) | Bajo |

## Plan propuesto (fases, cada una con tests + QA)
1. **Ritmo**: detector de tempo/beats + cuantización a compás (src/rhythm.ts) y MIDI cuantizado. Eval nueva de ritmo en scripts/eval.cjs.
2. **Partitura y tab reales**: render con alphaTab (gratis, MIT-like; partitura + tab + reproducción sincronizada).
3. **Export**: MusicXML (propio), Guitar Pro (.gp vía alphaTab), PDF (impresión del render).
4. **Editor**: clic en nota → cambiar traste/cuerda/duración, borrar/añadir, deshacer.
5. **Separación**: Demucs en GuitarrIA Local (.exe) para aislar guitarra; web sigue igual.
6. **Bajo/ukelele**: afinaciones y rangos nuevos en fingering.ts.

## Estado (2026-11-11)
| # | Brecha | Estado |
|---|---|---|
| 1 | Ritmo | Hecho: `src/rhythm.ts` (pulso por programación dinámica, compás, tonalidad, cuantización); editable (BPM, ÷2/×2, marcar pulso, compás, tonalidad). Medido en `eval/` (casos `ritmo_*`). |
| 2 | Partitura + tab con figuras | Hecho: alphaTab (`src/sheet.ts`), vistas Tab rápida / Partitura + tab / Partitura / Tab con ritmo, cursor sincronizado. |
| 3 | Editor | Hecho: trastes por cuerda, duración, mover, añadir, borrar, deshacer/rehacer; se guarda en el proyecto. |
| 4 | Export | Hecho: MusicXML, Guitar Pro 7 (.gp), PDF (impresión), MIDI cuantizado. Falta LilyPond (poco usado). |
| 5 | Aislar la guitarra | Parcial: separación armónico/percusiva + quitar el centro estéreo, en el navegador. Un modelo neuronal (Demucs) queda para GuitarrIA Local: pesa ~1 GB con PyTorch. |
| 6 | Más instrumentos | Hecho: bajo 4/5 cuerdas y ukelele (GCEA, Sol grave, barítono), 7 cuerdas. |
| 7 | Instagram/TikTok | Hecho vía GuitarrIA Local v3 (solo viaja el id). |
| 8 | App móvil | Pendiente: la web funciona en el móvil (micrófono incluido). |

### Medición (scripts/qa.sh, 2026-11-11)
- Ritmo: tempo correcto 100 %, compás 90 %, primer tiempo 70 %, nota en su semicorchea 96 %.
- Canción completa en estéreo (voz, bajo y batería): F1 45 % → **92 %** con «Separar guitarra».
- Notas (F1 medio) 94 % y acordes 82 %, sin cambios respecto a antes.
