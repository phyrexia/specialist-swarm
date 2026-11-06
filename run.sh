#!/usr/bin/env bash
# Experience Atlas demo server. Keys are read from the environment / Keychain and never printed.
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s openai-tts-api-key -w 2>/dev/null || true)"
  export OPENAI_API_KEY
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ANTHROPIC_API_KEY is not set" >&2
  exit 1
fi
PORT="${PORT:-8765}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is busy (another service); using 8766" >&2
  PORT=8766
fi
echo "Experience Atlas on http://127.0.0.1:$PORT/" >&2
exec uv run uvicorn app.server:app --host 127.0.0.1 --port "$PORT"
