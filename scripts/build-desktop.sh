#!/bin/bash
# Build the Voxly desktop apps (Windows x64 + macOS arm64/x64) with @electron/packager.
# The apps open the hosted site (HOSTED_URL in electron/main.cjs), so everyone shares
# one set of accounts; the desktop app adds what browsers can't: remote control
# (consent-gated) and native notifications. Output: dist-build/*.zip
set -e
cd "$(dirname "$0")/.."

IGNORE="^/(server|dist|dist-build|src|build|scripts|public|\.claude|\.git|README\.md|HOSTING\.md|render\.yaml|index\.html|vite\.config\.js|eslint\.config\.js)(/|$)"
mkdir -p dist-build

pack() { # platform arch icon
  echo "==> Packaging $1-$2…"
  npx @electron/packager . Voxly --platform="$1" --arch="$2" \
    --out=dist-build --overwrite --asar=false --prune=true \
    --icon="$3" --app-version="1.1.0" --app-bundle-id=com.attackstudios.voxly \
    --extend-info=scripts/mac-usage.plist \
    --ignore="$IGNORE"
}

pack win32 x64 build/icon.ico
pack darwin arm64 build/icon.icns
pack darwin x64 build/icon.icns

cd dist-build
rm -f Voxly-*.zip
(cd Voxly-win32-x64 && zip -qry ../Voxly-Windows.zip .)
ditto -c -k --keepParent Voxly-darwin-arm64/Voxly.app Voxly-Mac-AppleSilicon.zip
ditto -c -k --keepParent Voxly-darwin-x64/Voxly.app Voxly-Mac-Intel.zip
ls -lh Voxly-*.zip
