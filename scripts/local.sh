#!/usr/bin/env bash
# Arranca GuitarrIA Local desde el código (Mac/Linux, o Windows con Git Bash) sin el .exe.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv-local ] || python3 -m venv .venv-local
.venv-local/bin/pip install -q -r local/requirements.txt
exec .venv-local/bin/python local/guitarria_local.py
