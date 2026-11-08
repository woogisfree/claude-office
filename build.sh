#!/bin/bash
# Builds the app bundle with swiftc and an Info.plist (no Xcode project), then launches it.
# Usage: ./build.sh [--no-open]   (--no-open: build only, do not launch the app)
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "Error: $1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This can only be built on macOS."

# 1) Check for the Swift compiler
if ! command -v swiftc >/dev/null 2>&1; then
  fail "swiftc was not found. Install the Command Line Tools with the command below, then run this again.
    xcode-select --install"
fi

# 2) Check for Node.js. The app looks for node in a login shell, so check the same way.
NODE_BIN="$(zsh -lic 'command -v node' 2>/dev/null | tail -n 1 || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  fail "Node.js was not found. Install Node 18 or later, then run this again.
    brew install node"
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node 18 or later is required. Current version: $("$NODE_BIN" -v) ($NODE_BIN)"

# 3) Build for this CPU architecture
case "$(uname -m)" in
  arm64)  ARCH=arm64 ;;
  x86_64) ARCH=x86_64 ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac

APP="build/Claude Office.app"
# Build in a staging folder and replace the existing app only when everything succeeded, so a failed build keeps the working app.
STAGE_DIR="build/.staging"
STAGE="$STAGE_DIR/Claude Office.app"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"
swiftc -O -o "$STAGE/Contents/MacOS/ClaudeOffice" app/main.swift -target "$ARCH-apple-macos13.0"
cp app/Info.plist "$STAGE/Contents/Info.plist"
cp -R server "$STAGE/Contents/Resources/server"
[ -f app/AppIcon.icns ] && cp app/AppIcon.icns "$STAGE/Contents/Resources/AppIcon.icns"
[ -f app/StatusIcon.png ] && cp app/StatusIcon.png "$STAGE/Contents/Resources/StatusIcon.png"
codesign --force --deep --sign - "$STAGE"
rm -rf "$APP"
mv "$STAGE" "$APP"
rm -rf "$STAGE_DIR"
echo "Done: $APP ($ARCH, Node $("$NODE_BIN" -v))"

if [ "${1:-}" != "--no-open" ]; then
  # A running app is the old version, so quit it and open the new build.
  osascript -e 'tell application "Claude Office" to quit' >/dev/null 2>&1 || true
  sleep 1
  open "$APP"
fi
