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
