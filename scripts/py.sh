#!/bin/sh
# Run a Python script with the repo's interpreter: $PYTHON, else .venv/bin/python, else python3.
# Setup once:  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "$PYTHON" ]; then PY="$PYTHON"
elif [ -x "$ROOT/.venv/bin/python" ]; then PY="$ROOT/.venv/bin/python"
else PY="python3"; fi
exec "$PY" "$@"
