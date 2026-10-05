#!/bin/bash
# Launch the full stack on macOS the RIGHT way: backend + web under one process,
# and Electron via `open` so it's a LaunchServices app (its own TCC "responsible
# process"). If Electron is started from the terminal with `electron .`, macOS
# attributes camera/mic prompts to the terminal instead of Electron, and the
# camera silently returns black frames. Launching via `open` fixes that.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

cleanup() {
  echo "\nShutting down…"
  kill "$STACK_PID" 2>/dev/null || true
  pkill -f "$ROOT/node_modules/electron/dist/Electron.app" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# backend (:3001) + vite (:5173)
npx concurrently -k -n server,web -c blue,green "npm:server" "npm:dev" &
STACK_PID=$!

# wait for the web server to be reachable, then open the desktop app
for i in $(seq 1 30); do
  if curl -s "http://localhost:3001/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
sleep 1
echo "Launching desktop app via LaunchServices (open)…"
open "$ROOT/node_modules/electron/dist/Electron.app" --args "$ROOT"

wait "$STACK_PID"
