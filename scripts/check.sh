#!/usr/bin/env bash
# Tests + typecheck + build de producción. Úsalo antes de cada commit.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
npm run build
