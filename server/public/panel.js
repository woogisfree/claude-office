// 세션 카드, 사용량, 필터, 서버 폴링, 시작 코드.
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const collapsed = new Set();
let fStatus = store.get('office.fStatus', 'all');
let fProject = store.get('office.fProject', 'all');

const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
const fmtDur = (ms) => fmtMin(Math.floor(ms / 60000));
const projOf = (s) => (s.cwd || '').split('/').filter(Boolean).pop() || tr('unknownProject');
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
  const labels = { waiting: tr('stWaiting'), busy: tr('stBusy'), idle: tr('stIdle') };
  const counts = {}; rows.forEach((r) => { if (!r.child) counts[r.s.status] = (counts[r.s.status] || 0) + 1; });
  let html = '', lastGroup = null;
  for (const { s, child } of rows) {
    if (fStatus === 'all' && !child && s.status !== lastGroup) { lastGroup = s.status; html += `<div class="group">${labels[s.status]} ${counts[s.status]}</div>`; }
    const hasKids = !child && list.some((x) => x.parentId === s.sessionId);
    const lim = s.ctxTokens > 200000 || !/claude-(3-|haiku-4-5|sonnet-4(?!-[6-9])|opus-4(?!-[6-9]))/.test(s.model || '') ? 1e6 : 2e5;
    const act = s.status === 'waiting' ? waitingText(s.waitingFor) : s.status === 'busy' ? (actText(s.activity) || tr('working')) : (s.lastPrompt || tr('standby'));
    html += `<div class="card ${s.status} ${child ? 'child' : ''}" data-id="${esc(s.sessionId)}">
      ${hasKids ? `<button class="fold" data-fold="${esc(s.sessionId)}">${collapsed.has(s.sessionId) ? tr('unfold') : tr('fold')}</button>` : ''}
      <div class="name">${esc(s.name)}</div><div class="proj">${esc(projOf(s))}${child ? ' · ' + (s.kind === 'teammate' ? tr('teammate') : tr('subagent')) : ''}</div>
      <div class="act">${esc(act)}</div>
      ${child ? '' : `<div class="meta"><span>${fmtDur(s.workedMs)}</span><span>${tr('tokens', fmtTok(s.tokensToday))}</span><span>${fmtTok(s.ctxTokens)} (${Math.round((s.ctxTokens / lim) * 100)}%)</span></div>`}
    </div>`;
  }
  html = html || `<div class="group">${list.length ? tr('noMatch') : tr('noSessions')}</div>`;
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; box.scrollTop = prevScroll; onHover(hoverId); }
  // 프로젝트 필터 목록
  const sel = $('#fProject'), projects = [...new Set(list.filter((s) => !s.parentId).map(projOf))].sort();
  const want = ['all', ...projects].join('|');
  if (sel.dataset.sig !== want) {
    sel.dataset.sig = want;
    sel.innerHTML = `<option value="all">${tr('allProjects')}</option>` + projects.map((p) => `<option>${esc(p)}</option>`).join('');
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
$('#hourReset').addEventListener('click', () => { hourOverride = null; $('#hourText').textContent = tr('hourReal'); });

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
const fmtLeft = (sec) => fmtMin(Math.max(0, Math.round(sec / 60)));
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
  if (!f && !w) { appState = 'error'; renderUsage(); post('log:unrecognized usage response keys: ' + Object.keys(raw || {}).join(',')); return; }
  appUsageAt = Date.now(); appState = 'ok';
  lastUsage = { ok: true, fiveHour: f, weekly: w, updatedAt: Date.now() };
  renderUsage();
};
// 일시적인 실패(error)는 마지막 성공값을 그대로 두고 낡았다고 표시한다. 로그인이 풀린 경우(login)만 값을 지우고 로그인 안내를 보여 준다.
window.setAppUsageState = (st) => { appState = st; if (st === 'login') lastUsage = null; renderUsage(); };
const post = (m) => { try { window.webkit.messageHandlers.office.postMessage(m); } catch {} };

function emptyText() {
  if (appState === 'login') return [tr('needLogin'), tr('needLoginHint')];
  if (appState === 'error') return [tr('fetchFail'), tr('fetchFailHint')];
  return [tr('noInfo'), tr('noInfoHint')];
}
// staleMs: 마지막 성공 뒤 지난 시간(밀리초). 0이 아니면 마지막으로 가져온 값을 흐리게 보여 준다.
function renderMeter(el, w, name, staleMs = 0) {
  const txt = el.querySelector('.txt'), fill = el.querySelector('.bar i');
  el.classList.remove('mid', 'low', 'none', 'click', 'stale');
  if (!w) { const [t, hint] = emptyText(); el.classList.add('none'); if (appState === 'login') el.classList.add('click'); fill.style.width = '0%'; txt.textContent = t; el.title = hint; return; }
  const expired = w.resetsAt && w.resetsAt * 1000 <= Date.now();
  const used = expired ? 0 : Math.min(100, Math.max(0, w.pct)), left = Math.round(100 - used);
  fill.style.width = left + '%';
  el.classList.toggle('mid', left <= 50 && left > 20); el.classList.toggle('low', left <= 20);
  const stale = staleMs > 0 && !expired; // 초기화 시각이 지났으면 값이 낡았어도 100%로 돌아온 것이 확실하다.
  const reset = expired ? tr('resetDone') : stale ? tr('asOf', fmtLeft(staleMs / 1000)) : w.resetsAt ? tr('resetsIn', fmtLeft(w.resetsAt - Date.now() / 1000)) : '';
  el.classList.toggle('stale', stale);
  txt.innerHTML = `<b>${left}%</b> ${tr('left')}${reset ? ` <span class="reset">· ${reset}</span>` : ''}`;
  el.title = `${tr('meterTitle', name, Math.round(used), left)}${reset ? ' (' + reset + ')' : ''}${stale ? '. ' + tr('staleNote') : ''}`;
}
const STALE_GRACE_MS = 150000, STALE_LIMIT_MS = 6 * 3600 * 1000;
function renderUsage() {
  let u = lastUsage;
  // 가져오기에 실패한 상태에서 마지막 성공 뒤 2분 30초가 지나면 낡은 값으로 표시하고, 6시간이 지나면 값을 포기한다.
  const age = u && appState === 'error' ? Date.now() - (u.updatedAt || 0) : 0;
  if (age > STALE_LIMIT_MS) u = null;
  const stale = age > STALE_GRACE_MS ? age : 0;
  renderMeter($('#u5'), u && u.ok ? u.fiveHour : null, tr('name5'), stale);
  renderMeter($('#uw'), u && u.ok ? u.weekly : null, tr('nameW'), stale);
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

window.pollSun = pollSun;
async function pollSun() {
  try {
    const s = await (await fetch('/api/sun')).json();
    const changed = Math.abs(s.sunrise - sunInfo.sunrise) > 0.01 || Math.abs(s.sunset - sunInfo.sunset) > 0.01;
    Object.assign(sunInfo, s);
    store.set('office.sun', JSON.stringify({ sunrise: s.sunrise, sunset: s.sunset, utcOffset: s.utcOffset }));
    if (changed && sunInfo.__seen) toast(tr('sunChanged', s.sunrise.toFixed(1), s.sunset.toFixed(1)));
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
