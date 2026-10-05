#!/bin/bash
# Build a standalone Windows app (Voxly.exe) using @electron/packager.
# Produces a portable folder under dist-build/Voxly-win32-x64/ — no installer,
# no Wine needed (works from macOS). The app bundles its own backend and writes
# data to the user's AppData folder, so it runs without a separate server.
set -e
cd "$(dirname "$0")/.."

echo "==> Building web frontend (API base = http://localhost:3001)…"
VITE_API_BASE="http://localhost:3001" npx vite build

echo "==> Packaging Windows x64 app…"
rm -rf dist-build/Voxly-win32-x64
npx @electron/packager . Voxly \
  --platform=win32 --arch=x64 \
  --out=dist-build --overwrite --asar=false --prune=true \
  --icon=build/icon.ico \
  --app-version="1.0.0" \
  --ignore="^/(server/data|dist-build|src|build|scripts|\.claude|\.git|README\.md|eslint\.config\.js)(/|$)"

echo ""
echo "==> Done. Windows app at: dist-build/Voxly-win32-x64/Voxly.exe"
echo "    Zip it and send to a Windows machine; run Voxly.exe (no install needed)."
