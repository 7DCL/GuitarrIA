#!/usr/bin/env bash
# Servidor local con recarga en caliente: http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || ./scripts/setup.sh
npm run dev -- --host
