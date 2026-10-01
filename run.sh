#!/bin/sh
# Starts the brain and the surface; quitting the surface stops the brain.
# Live runs separately (open ableton/Perturbed Project/Perturbed.als).
cd "$(dirname "$0")"
SCLANG=/Applications/SuperCollider.app/Contents/MacOS/sclang

# npm may skip Electron's postinstall, which downloads the actual binary
if [ ! -d surface/node_modules/electron/dist ] || [ ! -d surface/node_modules/@xterm/xterm ]; then
  (cd surface && npm install && node node_modules/electron/install.js) || exit 1
fi
# the Claude drawer's pty (node-pty) is a native module, built against Electron (needs Xcode tools)
if [ ! -f surface/node_modules/node-pty/build/Release/pty.node ]; then
  (cd surface && npx electron-rebuild -f -w node-pty) || exit 1
fi
# the surface runs as Perturbed.app (Electron renamed; see surface/build-app.sh)
APP=build/Perturbed.app
if [ ! -d "$APP" ] || [ surface/icon/icon.icns -nt "$APP" ] || [ surface/build-app.sh -nt "$APP" ]; then
  surface/build-app.sh || exit 1
fi

"$SCLANG" brain/main.scd &
BRAIN=$!
trap 'kill -9 $BRAIN 2>/dev/null' EXIT   # sclang ignores SIGTERM

"$APP/Contents/MacOS/Electron" surface
