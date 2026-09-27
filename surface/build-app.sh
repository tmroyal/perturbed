#!/bin/sh
# Builds build/Perturbed.app: Electron's app bundle renamed, with our icon, so macOS shows
# "Perturbed" in the menu bar and Dock. run.sh launches it with the surface folder (like
# `electron .`). APFS clone, so it's quick and costs little disk. Rebuild after updating Electron.
set -e
cd "$(dirname "$0")/.."
SRC=surface/node_modules/electron/dist/Electron.app
APP=build/Perturbed.app
PLIST="$APP/Contents/Info.plist"

rm -rf "$APP"
mkdir -p build
cp -Rc "$SRC" "$APP"
plutil -replace CFBundleName -string Perturbed "$PLIST"
plutil -replace CFBundleDisplayName -string Perturbed "$PLIST"
plutil -replace CFBundleIdentifier -string com.perturbed.surface "$PLIST"
cp surface/icon/icon.icns "$APP/Contents/Resources/electron.icns"
# Info.plist changed, so re-sign (ad hoc) or macOS refuses to launch it
codesign --force --deep --sign - "$APP" 2>/dev/null
echo "built $APP"
