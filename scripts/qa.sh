#!/usr/bin/env bash
# QA completa: tests, tipos, build, pruebas en navegador y precisión de transcripción/acordes.
# La usa CI antes de publicar; úsala también en local antes de subir cambios.
# Variables: SKIP_EVAL=1 para saltar la evaluación de precisión (la parte más lenta).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Tests unitarios y build =="
./scripts/check.sh
echo "== Pruebas en navegador =="
node scripts/e2e.cjs "${E2E_OUT:-e2e-out}"
if [ -z "${SKIP_EVAL:-}" ]; then
  echo "== Precisión (audios de prueba con notas y acordes conocidos) =="
  [ -f eval/data/cases.json ] || python3 eval/make_data.py
  CONFIGS='[{"label":"actual","noise":"off","autoTune":true,"mode":"lead","sensitivity":0.4},{"label":"actual+ruido","noise":"normal","autoTune":true,"mode":"lead","sensitivity":0.4}]' \
    MIN_F1="${MIN_F1:-0.88}" MIN_CHORDS="${MIN_CHORDS:-0.75}" node scripts/eval.cjs
fi
echo "QA OK"
