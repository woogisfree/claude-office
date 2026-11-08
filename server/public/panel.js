// 세션 카드, 사용량, 필터, 서버 폴링, 시작 코드.
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const collapsed = new Set();
let fStatus = store.get('office.fStatus', 'all');
let fProject = store.get('office.fProject', 'all');

const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
const fmtDur = (ms) => { const m = Math.floor(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const projOf = (s) => (s.cwd || '').split('/').filter(Boolean).pop() || '(알 수 없음)';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ordered(list) {
  const parents = list.filter((s) => !s.parentId);
  const kids = (id) => list.filter((s) => s.parentId === id);
  const pass = (s) => (fStatus === 'all' || s.status === fStatus) && (fProject === 'all' || projOf(s) === fProject);
  const rank = { waiting: 0, busy: 1, idle: 2 };
  parents.sort((a, b) => a.status === 'waiting' && b.status === 'waiting' ? a.statusUpdatedAt - b.statusUpdatedAt : (fStatus === 'all' ? rank[a.status] - rank[b.status] : 0) || a.startedAt - b.startedAt);
  // 승인 대기는 맨 위에 오래 기다린 순서로 둔다.
  const out = [];
  for (const p of parents) if (pass(p)) { out.push({ s: p, child: false }); if (!collapsed.has(p.sessionId)) for (const c of kids(p.sessionId)) out.push({ s: c, child: true }); }
  return out;
}

function renderCards(list) {
  const box = $('#cards');
  const prevScroll = box.scrollTop;
  const rows = ordered(list);
  const labels = { waiting: '승인 대기', busy: '일하는 중', idle: '쉬는 중' };
  const counts = {}; rows.forEach((r) => { if (!r.child) counts[r.s.status] = (counts[r.s.status] || 0) + 1; });
  let html = '', lastGroup = null;
  for (const { s, child } of rows) {
    if (fStatus === 'all' && !child && s.status !== lastGroup) { lastGroup = s.status; html += `<div class="group">${labels[s.status]} ${counts[s.status]}</div>`; }
    const hasKids = !child && list.some((x) => x.parentId === s.sessionId);
    const lim = s.ctxTokens > 200000 || !/claude-(3-|haiku-4-5|sonnet-4(?!-[6-9])|opus-4(?!-[6-9]))/.test(s.model || '') ? 1e6 : 2e5;
    const act = s.status === 'waiting' ? waitingText(s.waitingFor) : s.status === 'busy' ? (s.activity || '작업 중') : (s.lastPrompt || '대기 중');
    html += `<div class="card ${s.status} ${child ? 'child' : ''}" data-id="${esc(s.sessionId)}">
      ${hasKids ? `<button class="fold" data-fold="${esc(s.sessionId)}">${collapsed.has(s.sessionId) ? '펴기' : '접기'}</button>` : ''}
      <div class="name">${esc(s.name)}</div><div class="proj">${esc(projOf(s))}${child ? ' · ' + (s.kind === 'teammate' ? '팀원' : '서브에이전트') : ''}</div>
      <div class="act">${esc(act)}</div>
      ${child ? '' : `<div class="meta"><span>${fmtDur(s.workedMs)}</span><span>${fmtTok(s.tokensToday)} 토큰</span><span>${fmtTok(s.ctxTokens)} (${Math.round((s.ctxTokens / lim) * 100)}%)</span></div>`}
    </div>`;
  }
  html = html || `<div class="group">${list.length ? '표시할 세션이 없습니다' : '실행 중인 세션이 없습니다. 터미널이나 Claude 데스크톱 앱에서 Claude Code를 시작하면 직원이 출근합니다.'}</div>`;
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; box.scrollTop = prevScroll; onHover(hoverId); }
  // 프로젝트 필터 목록
  const sel = $('#fProject'), projects = [...new Set(list.filter((s) => !s.parentId).map(projOf))].sort();
  const want = ['all', ...projects].join('|');
  if (sel.dataset.sig !== want) {
    sel.dataset.sig = want;
    sel.innerHTML = '<option value="all">전체 프로젝트</option>' + projects.map((p) => `<option>${esc(p)}</option>`).join('');
  }
  sel.value = fProject; $('#fStatus').value = fStatus;
}

$('#cards').addEventListener('click', (ev) => {
  const fold = ev.target.closest('[data-fold]');
  if (fold) { const id = fold.dataset.fold; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); renderCards(sessionList); ev.stopPropagation(); return; }
  const card = ev.target.closest('.card'); if (!card) return;
  fetch('/api/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: card.dataset.id }) }).catch(() => {});
});
$('#cards').addEventListener('mouseover', (ev) => { const c = ev.target.closest('.card'); hoverId = c ? c.dataset.id : null; });
$('#cards').addEventListener('mouseleave', () => { hoverId = null; });
onHover = (id) => {
  document.querySelectorAll('.card.hl').forEach((c) => c.classList.remove('hl'));
  if (!id) return;
  const c = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (c) { c.classList.add('hl'); c.scrollIntoView({ block: 'nearest' }); }
};
$('#fStatus').addEventListener('change', (e) => { fStatus = e.target.value; store.set('office.fStatus', fStatus); renderCards(sessionList); });
$('#fProject').addEventListener('change', (e) => { fProject = e.target.value; store.set('office.fProject', fProject); renderCards(sessionList); });
$('#panelBtn').addEventListener('click', () => { $('#panel').classList.toggle('folded'); resize(); });
$('#helpBtn').addEventListener('click', showHelp);

// 시간 막대
$('#hour').addEventListener('input', (e) => { hourOverride = Number(e.target.value); $('#hourText').textContent = `${Math.floor(hourOverride)}:${String(Math.round((hourOverride % 1) * 60)).padStart(2, '0')}`; });
$('#hourReset').addEventListener('click', () => { hourOverride = null; $('#hourText').textContent = '실제 시각'; });

let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500); }

async function pollSessions() {
  try {
    const r = await fetch('/api/sessions');
    $('#missing').hidden = r.headers.get('x-sessions-dir-missing') !== '1';
    const list = await r.json();
    applySessions(list); renderCards(list);
  } catch {}
}
let lastUsage = null;
function fmtLeft(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 60) return `${m}분`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
}
// 앱(Swift)이 claude.ai에서 가져온 사용량을 넘겨받는다. 응답 형식이 공개 규격이 아니라서 필드 이름을 느슨하게 해석한다.
let appUsageAt = 0, appState = '';
const toWindow = (o) => {
  if (!o || typeof o !== 'object') return null;
  let p = o.utilization ?? o.used_percentage ?? o.percentage ?? o.percent;
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return null;
  let r = o.resets_at ?? o.reset_at ?? o.resetsAt;
  if (typeof r === 'string') r = Date.parse(r) / 1000;
  return { pct: Number(p), resetsAt: Number.isFinite(r) ? r : 0 };
};
window.setAppUsage = (raw) => {
  const f = toWindow(raw && raw.five_hour), w = toWindow(raw && raw.seven_day);
  if (!f && !w) { appState = 'error'; renderUsage(); post('log:알 수 없는 사용량 응답 키: ' + Object.keys(raw || {}).join(',')); return; }
  appUsageAt = Date.now(); appState = 'ok';
  lastUsage = { ok: true, fiveHour: f, weekly: w, updatedAt: Date.now() };
  renderUsage();
};
window.setAppUsageState = (st) => { appState = st; if (st !== 'ok' && Date.now() - appUsageAt > 150000) lastUsage = null; renderUsage(); };
const post = (m) => { try { window.webkit.messageHandlers.office.postMessage(m); } catch {} };

function fmtLeft(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 60) return `${m}분`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
}
function emptyText() {
  if (appState === 'login') return ['로그인 필요', '클릭하면 claude.ai 로그인 창이 열립니다.'];
  if (appState === 'error') return ['불러오기 실패', '잠시 뒤 다시 시도합니다. 계속 실패하면 로그 파일(~/Library/Logs/Claude Office.log)을 확인하세요.'];
  return ['정보 없음', '앱에서 claude.ai에 로그인하거나, Claude Code statusline이 한도 파일을 쓰면 표시됩니다.'];
}
function renderMeter(el, w, name) {
  const txt = el.querySelector('.txt'), fill = el.querySelector('.bar i');
  el.classList.remove('mid', 'low', 'none', 'click');
  if (!w) { const [t, hint] = emptyText(); el.classList.add('none'); if (appState === 'login') el.classList.add('click'); fill.style.width = '0%'; txt.textContent = t; el.title = hint; return; }
  const expired = w.resetsAt && w.resetsAt * 1000 <= Date.now();
  const used = expired ? 0 : Math.min(100, Math.max(0, w.pct)), left = Math.round(100 - used);
  fill.style.width = left + '%';
  el.classList.toggle('mid', left <= 50 && left > 20); el.classList.toggle('low', left <= 20);
  const reset = expired ? '초기화됨' : w.resetsAt ? `${fmtLeft(w.resetsAt - Date.now() / 1000)} 후 초기화` : '';
  txt.innerHTML = `<b>${left}%</b> 남음${reset ? ` <span class="reset">· ${reset}</span>` : ''}`;
  el.title = `${name}: ${Math.round(used)}% 사용, ${left}% 남음${reset ? ' (' + reset + ')' : ''}`;
}
function renderUsage() {
  const u = lastUsage;
  renderMeter($('#u5'), u && u.ok ? u.fiveHour : null, '5시간 한도');
  renderMeter($('#uw'), u && u.ok ? u.weekly : null, '주간 한도');
}
$('#usage').addEventListener('click', () => { if (appState === 'login') post('login'); });
// 앱이 가져온 값이 최근이면 그것을 쓰고, 아니면 statusline이 쓴 파일을 읽는다.
async function pollUsage() {
  if (Date.now() - appUsageAt < 150000) return;
  try {
    const u = await (await fetch('/api/usage')).json();
    if (u.ok) lastUsage = u;
    renderUsage();
  } catch {}
}

async function pollSun() {
  try {
    const s = await (await fetch('/api/sun')).json();
    const changed = Math.abs(s.sunrise - sunInfo.sunrise) > 0.01 || Math.abs(s.sunset - sunInfo.sunset) > 0.01;
    Object.assign(sunInfo, s);
    store.set('office.sun', JSON.stringify({ sunrise: s.sunrise, sunset: s.sunset }));
    if (changed && sunInfo.__seen) toast(`일출 ${s.sunrise.toFixed(1)}시, 일몰 ${s.sunset.toFixed(1)}시로 바뀌었습니다.`);
    sunInfo.__seen = true;
  } catch {}
}

// 시작 코드
resize();
pollSun(); pollSessions(); pollUsage();
setInterval(pollSessions, 2000);
setInterval(pollUsage, 5000);
setInterval(renderUsage, 30000);
setInterval(pollSun, 60000);
requestAnimationFrame(loop);
