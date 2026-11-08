#!/bin/bash
# Xcode 프로젝트 없이 swiftc 와 Info.plist 만으로 앱 번들을 만든 뒤 실행한다.
# 사용법: ./build.sh [--no-open]   (--no-open: 빌드만 하고 앱은 실행하지 않는다)
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "오류: $1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "macOS에서만 빌드할 수 있습니다."

# 1) Swift 컴파일러 확인
if ! command -v swiftc >/dev/null 2>&1; then
  fail "swiftc 를 찾을 수 없습니다. 아래 명령으로 Command Line Tools 를 설치한 뒤 다시 실행해 주세요.
    xcode-select --install"
fi

# 2) Node.js 확인. 앱이 로그인 셸에서 node 를 찾으므로 같은 방식으로 확인한다.
NODE_BIN="$(zsh -lic 'command -v node' 2>/dev/null | tail -n 1 || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  fail "Node.js 를 찾을 수 없습니다. Node 18 이상을 설치한 뒤 다시 실행해 주세요.
    brew install node"
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node 18 이상이 필요합니다. 현재 버전: $("$NODE_BIN" -v) ($NODE_BIN)"

# 3) CPU 아키텍처에 맞춰 빌드
case "$(uname -m)" in
  arm64)  ARCH=arm64 ;;
  x86_64) ARCH=x86_64 ;;
  *) fail "지원하지 않는 아키텍처입니다: $(uname -m)" ;;
esac

APP="build/Claude Office.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/ClaudeOffice" app/main.swift -target "$ARCH-apple-macos13.0"
cp app/Info.plist "$APP/Contents/Info.plist"
cp -R server "$APP/Contents/Resources/server"
[ -f app/AppIcon.icns ] && cp app/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
[ -f app/StatusIcon.png ] && cp app/StatusIcon.png "$APP/Contents/Resources/StatusIcon.png"
codesign --force --deep --sign - "$APP"
echo "완료: $APP ($ARCH, Node $("$NODE_BIN" -v))"

if [ "${1:-}" != "--no-open" ]; then
  # 이미 실행 중인 앱은 이전 버전이므로 종료하고 새로 연다.
  osascript -e 'tell application "Claude Office" to quit' >/dev/null 2>&1 || true
  sleep 1
  open "$APP"
fi
