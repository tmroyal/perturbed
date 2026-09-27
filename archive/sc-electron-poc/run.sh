#!/bin/sh
# Starts the SuperCollider engine and the Electron UI; quitting the UI stops the engine.
# Usage: ./run.sh   (instruments and voices are configured in engine/setup.scd)
cd "$(dirname "$0")"
SCLANG=/Applications/SuperCollider.app/Contents/MacOS/sclang

# npm may skip Electron's postinstall, which downloads the actual binary
if [ ! -d app/node_modules/electron/dist ]; then
  (cd app && npm install && node node_modules/electron/install.js) || exit 1
fi

"$SCLANG" engine/main.scd &
SC_PID=$!
trap 'kill $SC_PID 2>/dev/null; killall scsynth 2>/dev/null' EXIT

(cd app && npx electron .)
