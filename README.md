# Claude Office

지금 실행 중인 Claude Code 세션을 픽셀아트 사무실의 직원으로 보여 주는 macOS 메뉴 막대 앱입니다.

> **고지**: 개인이 만든 비공식 프로젝트이며, Anthropic과 관련이 없습니다. "Claude"와 "Claude Code"는 Anthropic의 상표입니다.

## 기능

- 세션마다 책상 하나가 배정되고, 상태가 직원의 행동으로 표현됩니다.
  - **일하는 중**: 자리에 앉아 타이핑합니다. 토큰 사용 속도가 임계값을 넘으면 카페인 폭주 모드가 됩니다.
  - **승인 대기**: 손을 들고 기다립니다.
  - **쉬는 중**: 휴게 공간으로 이동합니다.
- 카페인 폭주 중에는 책상 위로 서류가 날아다님
- 직원과 책상 구역(모니터, 리클라이너, 이름표) 어디에 마우스를 올려도 해당 세션이 강조됨
- 세션 카드를 누르면 해당 세션으로 이동: 터미널(tmux, cmux, Ghostty, iTerm) 세션은 창과 탭으로, Claude 데스크톱 앱 세션은 앱의 `claude://code/continue?session=local_…` 링크로 해당 채팅을 엽니다. 데스크톱 링크는 공식 문서에 없는 앱 내부 경로라 앱 업데이트로 바뀔 수 있습니다.
- 세션 카드 패널과 필터, 토큰 사용량 표시
- 5시간 한도와 주간 한도의 남은 비율 표시
- 테마: 사무실, 탄광, 크리스마스
- 실제 일출과 일몰, 날씨를 반영하는 창밖 풍경과 야간 조명
- 일하던 세션이 끝나거나 승인을 기다리면 알림
- 창 크기에 맞춰 책상 간격이 자동으로 조정됨

## 구성

| 계층 | 기술 |
|---|---|
| 앱 셸 | Swift (AppKit, WKWebView) |
| 로컬 서버 | Node.js, 의존성 없는 `node:http` |
| 화면 | 바닐라 JS, Canvas 2D |

서버는 `127.0.0.1`에서만 열리며 `~/.claude`를 읽기 전용으로 참조합니다.

## 요구 환경

- macOS 13 이상 (Apple Silicon과 Intel 모두 지원, 빌드할 때 자동으로 맞춥니다)
- Node.js 18 이상 (22에서 개발)
- Swift 컴파일러: Xcode 또는 Command Line Tools (`xcode-select --install`)

## 빌드와 실행

```bash
git clone https://github.com/woogisfree/claude-office
cd claude-office
./build.sh
```

`./build.sh`는 Swift와 Node가 설치되어 있는지 먼저 확인하고(없으면 설치 방법을 안내합니다), 앱을 빌드한 뒤 바로 실행합니다. 이미 실행 중인 앱은 종료하고 새 버전으로 다시 엽니다. 빌드만 하려면 `./build.sh --no-open`을 사용합니다.

Xcode 프로젝트 없이 `swiftc`로 빌드하고 ad-hoc 서명을 합니다. 서명된 배포용 바이너리는 제공하지 않으므로 직접 빌드해서 사용해야 합니다. 직접 빌드한 앱은 Gatekeeper에 막히지 않습니다.

`/Applications`에 설치하려면 빌드한 앱을 복사합니다. 실행 중이면 먼저 종료해야 합니다.

```bash
cp -R "build/Claude Office.app" /Applications/
```

화면만 확인하려면 서버를 단독으로 실행해도 됩니다.

```bash
PORT=0 node server/server.mjs
```

## 테스트

서버의 토큰 집계와 대화 기록 해석, 화면 배치 계산을 Node 내장 테스트로 확인합니다. 별도 설치는 필요 없습니다.

```bash
npm test
```

## 한도 표시에 대한 안내

5시간 및 주간 한도는 두 가지 경로로 가져옵니다.

1. Claude Code 상태 표시줄 스크립트가 남기는 캐시 파일(`~/.claude/.statusline-ratelimit-cache`)
2. 메뉴의 **claude.ai 로그인**으로 로그인한 세션을 사용해 claude.ai의 내부 사용량 API를 호출

2번 경로는 **공식 문서에 없는 비공식 엔드포인트**입니다. 예고 없이 동작이 바뀌거나 중단될 수 있으며, 사용에 따른 책임은 사용자에게 있습니다. 로그인 쿠키는 앱의 WebKit 저장소에만 보관되고 외부로 전송되지 않습니다. 메뉴의 **로그아웃**으로 삭제할 수 있습니다.

외부 네트워크 통신은 날씨와 일출 시각을 가져오는 Open-Meteo, 그리고 위의 claude.ai 호출뿐입니다.

## 폴더 구조

```
app/      Swift 앱 셸, Info.plist, 아이콘
server/   Node 서버(server.mjs)와 화면(public/)
build.sh  앱 번들 빌드 스크립트
```

## 라이선스

[MIT](LICENSE)
