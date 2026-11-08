// 화면 문구. 시스템 언어가 한국어이면 한국어, 그 밖에는 영어로 보여 준다.
// 다른 파일에서 지역 변수 t(시각)를 자주 쓰므로 번역 함수 이름은 tr로 둔다.
const LANG = /^ko\b/i.test(navigator.language || '') ? 'ko' : 'en';
const STR = {
  ko: {
    stWaiting: '승인 대기', stBusy: '일하는 중', stIdle: '쉬는 중',
    filterStatus: '상태 필터', filterProject: '프로젝트 필터', hourSlider: '창밖 시각',
    officeLabel: (n, w, b, i) => (n ? `사무실: 세션 ${n}개 (승인 대기 ${w}, 일하는 중 ${b}, 쉬는 중 ${i})` : '사무실: 실행 중인 세션이 없습니다'),
    allStatus: '전체 상태', allProjects: '전체 프로젝트', unknownProject: '(알 수 없음)',
    working: '작업 중', standby: '대기 중', fold: '접기', unfold: '펴기',
    teammate: '팀원', subagent: '서브에이전트', tokens: (n) => `${n} 토큰`,
    noMatch: '표시할 세션이 없습니다',
    goneRow: (n) => `퇴근한 세션 ${n}개`, goneIdle: (x) => `대기 ${x}`,
    noSessions: '실행 중인 세션이 없습니다. 터미널이나 Claude 데스크톱 앱에서 Claude Code를 시작하면 직원이 출근합니다.',
    hourReal: '실제 시각', hourBtn: '실제', hourTitle: '창밖 시각 미리보기', helpTitle: '화면 설명', panelTitle: '세션 패널 접기/펴기',
    lbl5: '5시간', lblW: '주간', name5: '5시간 한도', nameW: '주간 한도',
    left: '남음', resetDone: '초기화됨', asOf: (x) => `${x} 전 기준`, resetsIn: (x) => `${x} 후 초기화`,
    meterTitle: (name, used, left) => `${name}: ${used}% 사용, ${left}% 남음`,
    staleNote: '최신 값을 가져오지 못해 마지막으로 가져온 값을 보여 줍니다.',
    needLogin: '로그인 필요', needLoginHint: '클릭하면 claude.ai 로그인 창이 열립니다.',
    fetchFail: '불러오기 실패', fetchFailHint: '잠시 뒤 다시 시도합니다. 계속 실패하면 로그 파일(~/Library/Logs/Claude Office.log)을 확인하세요.',
    noInfo: '정보 없음', noInfoHint: '앱에서 claude.ai에 로그인하거나, Claude Code statusline이 한도 파일을 쓰면 표시됩니다.',
    sunChanged: (r, s) => `일출 ${r}시, 일몰 ${s}시로 바뀌었습니다.`,
    waitPerm: '권한 승인 요청', waitPlan: '계획 승인 요청', waitQuestion: '질문 응답 대기', waitInput: '입력 대기', waitDefault: '승인 대기',
    actResult: '결과 확인 중', actThinking: '생각 중', actWriting: '작성 중',
    minutes: (m) => `${m}분`, hours: (h, m) => `${h}시간${m ? ` ${m}분` : ''}`, days: (d, h) => `${d}일${h ? ` ${h}시간` : ''}`,
    helpOffice: '사무실: 실행 중인 Claude Code 세션이 직원으로 나타납니다. 책상마다 세션이 하나씩 앉습니다.',
    helpUsage: '사용량: 5시간 한도와 주간 한도의 사용률입니다. statusline이 캐시 파일을 써야 표시됩니다.',
    helpTime: '시간 막대: 창밖 시각을 미리 봅니다. 끌지 않으면 실제 시각을 따라갑니다.',
    helpFilters: '필터: 상태와 프로젝트로 카드를 걸러 냅니다. 고른 값은 기억됩니다.',
    helpCards: '세션 카드: 클릭하면 해당 터미널이 앞으로 옵니다. 노란색은 승인 대기, 초록색은 작업 중입니다.',
    missingTitle: '세션 폴더를 찾지 못했습니다.',
    missingBody: '폴더가 없습니다. Claude Code를 한 번 실행하면 자동으로 닫힙니다.',
  },
  en: {
    stWaiting: 'Waiting', stBusy: 'Working', stIdle: 'Resting',
    filterStatus: 'Filter by status', filterProject: 'Filter by project', hourSlider: 'Time of day outside the window',
    officeLabel: (n, w, b, i) => (n ? `Office: ${n} session${n > 1 ? 's' : ''} (${w} waiting, ${b} working, ${i} resting)` : 'Office: no running sessions'),
    allStatus: 'All statuses', allProjects: 'All projects', unknownProject: '(unknown)',
    working: 'Working', standby: 'Idle', fold: 'Collapse', unfold: 'Expand',
    teammate: 'Teammate', subagent: 'Subagent', tokens: (n) => `${n} tokens`,
    noMatch: 'No sessions to show',
    goneRow: (n) => `${n} session${n > 1 ? 's' : ''} clocked out`, goneIdle: (x) => `idle ${x}`,
    noSessions: 'No running sessions. Start Claude Code in a terminal or the Claude desktop app and an employee will show up for work.',
    hourReal: 'Real time', hourBtn: 'Now', hourTitle: 'Preview the time of day outside the window', helpTitle: 'What am I looking at?', panelTitle: 'Show or hide the session panel',
    lbl5: '5h', lblW: 'Weekly', name5: '5-hour limit', nameW: 'Weekly limit',
    left: 'left', resetDone: 'reset', asOf: (x) => `as of ${x} ago`, resetsIn: (x) => `resets in ${x}`,
    meterTitle: (name, used, left) => `${name}: ${used}% used, ${left}% left`,
    staleNote: 'The latest value could not be fetched, so the last known value is shown.',
    needLogin: 'Login required', needLoginHint: 'Click to open the claude.ai login window.',
    fetchFail: 'Fetch failed', fetchFailHint: 'Will retry shortly. If it keeps failing, check the log file (~/Library/Logs/Claude Office.log).',
    noInfo: 'No data', noInfoHint: 'Log in to claude.ai in the app, or let the Claude Code statusline write the limit file.',
    sunChanged: (r, s) => `Sunrise ${r}h and sunset ${s}h updated.`,
    waitPerm: 'Permission request', waitPlan: 'Plan approval', waitQuestion: 'Question pending', waitInput: 'Waiting for input', waitDefault: 'Waiting for approval',
    actResult: 'Checking results', actThinking: 'Thinking', actWriting: 'Writing',
    minutes: (m) => `${m}m`, hours: (h, m) => `${h}h${m ? ` ${m}m` : ''}`, days: (d, h) => `${d}d${h ? ` ${h}h` : ''}`,
    helpOffice: 'Office: each running Claude Code session shows up as an employee, one session per desk.',
    helpUsage: 'Usage: how much of the 5-hour and weekly limits is left. It appears once the statusline writes the cache file or you log in to claude.ai.',
    helpTime: 'Time bar: preview the time of day outside the window. Leave it alone to follow the real time.',
    helpFilters: 'Filters: narrow the cards by status and project. Your choice is remembered.',
    helpCards: 'Session cards: click one to bring its terminal or chat to the front. Yellow means waiting for approval, green means working.',
    missingTitle: 'Session folder not found.',
    missingBody: 'folder does not exist. It closes by itself once you run Claude Code.',
  },
};
const tr = (k, ...a) => { const v = STR[LANG][k] ?? STR.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
// 분 단위 시간을 "2시간 5분" 또는 "2h 5m" 꼴로 적는다.
const fmtMin = (m) => (m < 60 ? tr('minutes', m) : m < 1440 ? tr('hours', Math.floor(m / 60), m % 60) : tr('days', Math.floor(m / 1440), Math.floor((m % 1440) / 60)));
// 서버가 보내는 상태 문구 코드(@로 시작)를 현재 언어로 바꾼다. 그 밖의 문구(도구 이름 등)는 그대로 쓴다.
const ACT_KEYS = { '@result': 'actResult', '@thinking': 'actThinking', '@writing': 'actWriting' };
const actText = (a) => (ACT_KEYS[a] ? tr(ACT_KEYS[a]) : a);
document.documentElement.lang = LANG;
document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); if (el.tagName === 'BUTTON') el.setAttribute('aria-label', tr(el.dataset.i18nTitle)); });
// Controls with no visible text get a spoken name.
document.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', tr(el.dataset.i18nLabel)); });
