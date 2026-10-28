#!/usr/bin/env bash
# Instala dependencias y deja el modelo listo.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci || npm install
node scripts/copy-model.mjs
