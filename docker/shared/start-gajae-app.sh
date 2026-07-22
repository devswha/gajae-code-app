#!/bin/bash

# This script is sourced from ~/.bashrc whenever an agent shell opens.
# The application code is immutable at /opt/gajae-app; sandbox state and
# logs belong to the agent's canonical data root.
GAJAE_APP_ROOT="${GAJAE_APP_ROOT:-/opt/gajae-app}"
GAJAE_APP_DATA_ROOT="${GAJAE_APP_DATA_ROOT:-$HOME/.gajae-app}"
GAJAE_APP_LOG_FILE="${GAJAE_APP_LOG_FILE:-$GAJAE_APP_DATA_ROOT/logs/sandbox.log}"
GAJAE_APP_PORT="${SERVER_PORT:-3001}"

if ! command -v gajae-app >/dev/null 2>&1; then
  printf 'Gajae App sandbox is not installed. Rebuild the local gajae-app-sandbox image from prepared repository source.\n' >&2
  return 1 2>/dev/null || exit 1
fi

if [ ! -f "$GAJAE_APP_ROOT/dist-server/server/cli.js" ]; then
  printf 'Gajae App sandbox source is missing at %s. Rebuild the local image from prepared repository source.\n' "$GAJAE_APP_ROOT" >&2
  return 1 2>/dev/null || exit 1
fi

mkdir -p "$(dirname "$GAJAE_APP_LOG_FILE")"
# The canonical log stays under ~/.gajae-app. This link keeps the CLI's
# sandbox log command compatible with existing running sandboxes.
ln -sfn "$GAJAE_APP_LOG_FILE" /tmp/gajae-app-ui.log

if ! pgrep -f "$GAJAE_APP_ROOT/dist-server/server/cli.js" >/dev/null 2>&1; then
  nohup gajae-app start --host 0.0.0.0 --port "$GAJAE_APP_PORT" >> "$GAJAE_APP_LOG_FILE" 2>&1 &
  disown || true

  printf '\n  Gajae App is starting on port %s.\n\n' "$GAJAE_APP_PORT"
  printf '  Forward the port from another terminal:\n'
  printf '    sbx ports <sandbox-name> --publish %s:%s\n\n' "$GAJAE_APP_PORT" "$GAJAE_APP_PORT"
  printf '  Then open: http://localhost:%s\n\n' "$GAJAE_APP_PORT"
fi
