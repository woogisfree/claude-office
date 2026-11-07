#!/bin/bash
# Xcode 프로젝트 없이 swiftc 와 Info.plist 만으로 앱 번들을 만든다.
set -euo pipefail
cd "$(dirname "$0")"
APP="build/Claude Office.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/ClaudeOffice" app/main.swift -target arm64-apple-macos13.0
cp app/Info.plist "$APP/Contents/Info.plist"
cp -R server "$APP/Contents/Resources/server"
[ -f app/AppIcon.icns ] && cp app/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
codesign --force --deep --sign - "$APP"
echo "완료: $APP"
