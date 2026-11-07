// Claude Office 로컬 서버: 의존성 없는 node:http 하나로 ~/.claude 를 읽어 세션 정보를 제공한다.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const CLAUDE = path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE, 'projects');
const TEAMS_DIR = path.join(CLAUDE, 'teams');
const USAGE_FILE = path.join(CLAUDE, '.statusline-ratelimit-cache');
const TAIL_BYTES = 256 * 1024;
const CHUNK = 8 * 1024 * 1024;
const WORKING_STALE_MS = 30 * 60 * 1000;

const sh = (cmd, args, timeout = 4000) =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout))),
  );

// ───────────────────────── 파일 읽기 도우미 ─────────────────────────
async function readTail(file, bytes = TAIL_BYTES) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return { text, size };
  } finally {
    await fh.close();
  }
}
const parseLines = (text) => {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* 잘린 줄은 무시 */ }
  }
  return out;
};

// ───────────────────────── 대화 기록 찾기 ─────────────────────────
const transcriptCache = new Map(); // sessionId -> path
let lastFullScan = 0;
async function findTranscript(sessionId, cwd) {
  const cached = transcriptCache.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;
  const dir = path.join(PROJECTS_DIR, String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-'));
  const direct = path.join(dir, `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) { transcriptCache.set(sessionId, direct); return direct; }
  if (Date.now() - lastFullScan < 30_000) return null;
  lastFullScan = Date.now();
  try {
    for (const d of await fsp.readdir(PROJECTS_DIR)) {
      const p = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if (fs.existsSync(p)) { transcriptCache.set(sessionId, p); return p; }
    }
  } catch { /* 폴더 없음 */ }
  return null;
}

// ───────────────────────── 세션 요약 ─────────────────────────
const titleMemo = new Map();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function describeTool(name, input = {}) {
  const target = input.file_path || input.description || input.command || input.pattern || input.query || input.url || input.skill || '';
  const t = typeof target === 'string' ? (input.file_path ? path.basename(target) : target) : '';
  return cut(t ? `${name} ${t}` : name, 60);
}

async function summarize(file, sessionId) {
  const { text } = await readTail(file);
  const rows = parseLines(text);
  let title = titleMemo.get(sessionId) || '';
  let lastPrompt = '';
  let activity = '';
  let ctxTokens = 0;
  let model = '';
  let failStreak = 0;
  const pending = new Map(); // tool_use id -> name

  for (const r of rows) {
    if (r.type === 'ai-title' && (r.aiTitle || r.title)) title = r.aiTitle || r.title;
    const msg = r.message;
    if (!msg) continue;
    if (r.type === 'user' && msg.role === 'user') {
      const c = msg.content;
      if (typeof c === 'string') {
        lastPrompt = cut(stripTags(c), 140); failStreak = 0; activity = '';
      } else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'text' && !r.isMeta) { lastPrompt = cut(stripTags(b.text), 140); failStreak = 0; }
          if (b.type === 'tool_result') {
            pending.delete(b.tool_use_id);
            const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
            const rejected = /user (doesn't want|rejected)|interrupted|request interrupted/i.test(txt);
            if (b.is_error && !rejected) failStreak++;
            else if (!b.is_error) failStreak = 0;
            activity = '결과 확인 중';
          }
        }
      }
    } else if (r.type === 'assistant' && msg.role === 'assistant') {
      if (msg.model && msg.model !== '<synthetic>') model = msg.model;
      const u = msg.usage;
      if (u) ctxTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
      for (const b of msg.content || []) {
        if (b.type === 'tool_use') { pending.set(b.id, b.name); activity = describeTool(b.name, b.input); }
        else if (b.type === 'thinking') activity = '생각 중';
        else if (b.type === 'text') activity = '작성 중';
      }
    }
  }
  if (title) titleMemo.set(sessionId, title);
  return { title, lastPrompt, activity, ctxTokens, model, failStreak };
}

// ───────────────────────── 토큰 통계 ─────────────────────────
const statsState = new Map(); // file -> {pos, day, tokens, seen:Set, workMs, lastReq, lastEnd, events:[[ts,tokens]], touched}
const statsLocks = new Map();
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

async function updateStats(file) {
  const prev = statsLocks.get(file) || Promise.resolve();
  const next = prev.then(() => doUpdateStats(file)).catch(() => {});
  statsLocks.set(file, next);
  await next;
  return statsState.get(file);
}
async function doUpdateStats(file) {
  let st = statsState.get(file);
  const stat = await fsp.stat(file);
  const today = dayKey();
  if (!st || st.day !== today || stat.size < st.pos) {
    st = { pos: 0, day: today, tokens: 0, seen: new Set(), workMs: 0, lastReq: 0, lastEnd: 0, events: [], touched: 0, carry: '' };
    statsState.set(file, st);
  }
  st.touched = Date.now();
  const midnight = startOfToday();
  const fh = await fsp.open(file, 'r');
  try {
    while (st.pos < stat.size) {
      const len = Math.min(CHUNK, stat.size - st.pos);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, st.pos);
      let text = st.carry + buf.toString('utf8');
      const nl = text.lastIndexOf('\n');
      if (nl < 0 && st.pos + len < stat.size) { st.carry = text; st.pos += len; continue; }
      st.carry = nl < 0 ? '' : text.slice(nl + 1);
      const complete = nl < 0 ? text : text.slice(0, nl);
      st.pos += len;
      for (const line of complete.split('\n')) {
        if (!line) continue;
        // 오늘 이전의 줄은 JSON 파싱 없이 건너뛴다.
        const m = line.match(/"timestamp":"([^"]+)"/);
        if (!m) continue;
        const ts = Date.parse(m[1]);
        if (!(ts >= midnight)) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        const msg = r.message;
        if (r.type === 'user' && msg && !r.isMeta) {
          const c = msg.content;
          const isPrompt = typeof c === 'string' || (Array.isArray(c) && c.some((b) => b.type === 'text'));
          if (isPrompt) {
            if (st.lastReq && st.lastEnd >= st.lastReq) st.workMs += st.lastEnd - st.lastReq;
            st.lastReq = ts; st.lastEnd = 0;
          }
        } else if (r.type === 'assistant' && msg) {
          if (msg.stop_reason === 'end_turn') st.lastEnd = ts;
          const u = msg.usage;
          if (u && msg.id && !st.seen.has(msg.id)) {
            st.seen.add(msg.id);
            const t = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1 + (u.output_tokens || 0) * 5;
            st.tokens += t;
            st.events.push([ts, t]);
          }
        }
      }
    }
  } finally { await fh.close(); }
}
function statsView(st) {
  if (!st) return { tokensToday: 0, workedMs: 0, tokensPerMin: 0 };
  const now = Date.now();
  const recent = st.events.filter(([ts]) => now - ts <= 5 * 60_000);
  st.events = st.events.filter(([ts]) => now - ts <= 10 * 60_000);
  const sum = recent.reduce((a, [, t]) => a + t, 0);
  let worked = st.workMs;
  if (st.lastReq) worked += (st.lastEnd >= st.lastReq ? st.lastEnd : now) - st.lastReq;
  return { tokensToday: Math.round(st.tokens), workedMs: Math.max(0, worked), tokensPerMin: Math.round(sum / 5) };
}
setInterval(() => {
  for (const [f, st] of statsState) if (Date.now() - st.touched > 60_000) statsState.delete(f);
}, 30_000).unref();

// ───────────────────────── 세션·서브에이전트·팀원 ─────────────────────────
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function readSessionFiles() {
  let names;
  try { names = await fsp.readdir(SESSIONS_DIR); } catch { return null; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR, n), 'utf8'));
      if (j && j.pid && j.sessionId && alive(j.pid)) out.push(j);
    } catch { /* 쓰는 중인 파일 */ }
  }
  return out;
}

async function buildSubagents(parent, transcript) {
  const dir = transcript.replace(/\.jsonl$/, '');
  const sub = path.join(dir, 'subagents');
  let names; try { names = await fsp.readdir(sub); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(sub, n), 'utf8'));
      if (meta.finished) continue;
      const jl = path.join(sub, n.replace(/\.meta\.json$/, '.jsonl'));
      const stat = await fsp.stat(jl).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs > WORKING_STALE_MS) continue;
      const id = n.replace(/\.meta\.json$/, '');
      const sum = await summarize(jl, `${parent.sessionId}:${id}`).catch(() => ({}));
      out.push({
        kind: 'subagent', sessionId: `${parent.sessionId}:${id}`, parentId: parent.sessionId, pid: parent.pid,
        name: meta.description || meta.agentType || id, cwd: parent.cwd, startedAt: meta.startedAt || stat.birthtimeMs,
        status: Date.now() - stat.mtimeMs < 20_000 ? 'busy' : 'idle', activity: sum.activity || '', ctxTokens: sum.ctxTokens || 0, model: sum.model || '',
        failStreak: sum.failStreak || 0, lastPrompt: '', title: '', tokensToday: 0, workedMs: 0, tokensPerMin: 0,
      });
    } catch { /* 건너뜀 */ }
  }
  return out;
}

async function buildTeammates(parents) {
  const ps = await sh('ps', ['-axo', 'pid=,args=']);
  const out = [];
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m || !m[2].includes('--agent-id')) continue;
    const arg = (k) => (m[2].match(new RegExp(`--${k}[= ]([^\\s]+)`)) || [])[1];
    const agentId = arg('agent-id'), parentId = arg('parent-session-id'), team = arg('team-name');
    if (!agentId || !parents.has(parentId)) continue;
    let active = true;
    try {
      const cfg = JSON.parse(await fsp.readFile(path.join(TEAMS_DIR, team, 'config.json'), 'utf8'));
      const mem = (cfg.members || []).find((x) => x.agentId === agentId || x.name === agentId.split('@')[0]);
      if (mem && mem.isActive === false) active = false;
    } catch { /* 설정 없음 */ }
    const parent = parents.get(parentId);
    out.push({
      kind: 'teammate', sessionId: `team:${agentId}`, parentId, pid: Number(m[1]), name: agentId.split('@')[0], cwd: parent.cwd,
      startedAt: parent.startedAt, status: active ? 'busy' : 'idle', activity: '', ctxTokens: 0, model: '', failStreak: 0,
      lastPrompt: '', title: '', tokensToday: 0, workedMs: 0, tokensPerMin: 0,
    });
  }
  return out;
}

let sessionsCache = { at: 0, value: null };
async function collectSessions(force = false) {
  if (!force && Date.now() - sessionsCache.at < 1500 && sessionsCache.value) return sessionsCache.value;
  const files = await readSessionFiles();
  if (files === null) return (sessionsCache = { at: Date.now(), value: { missing: true, list: [] } }).value;
  const list = [];
  const parents = new Map();
  await Promise.all(files.map(async (s) => {
    const tr = await findTranscript(s.sessionId, s.cwd);
    let sum = {}, stats = null;
    if (tr) {
      sum = await summarize(tr, s.sessionId).catch(() => ({}));
      stats = statsView(await updateStats(tr).catch(() => null));
    }
    const waiting = s.status === 'waiting' || !!s.waitingFor;
    const item = {
      kind: 'session', sessionId: s.sessionId, pid: s.pid, cwd: s.cwd, startedAt: s.startedAt,
      name: s.name || sum.title || path.basename(s.cwd || '') || s.sessionId.slice(0, 8),
      title: sum.title || '', lastPrompt: sum.lastPrompt || '',
      status: waiting ? 'waiting' : s.status === 'busy' ? 'busy' : 'idle',
      waitingFor: s.waitingFor || '', statusUpdatedAt: s.statusUpdatedAt || 0,
      activity: sum.activity || '', ctxTokens: sum.ctxTokens || 0, model: sum.model || '', failStreak: sum.failStreak || 0,
      ...(stats || { tokensToday: 0, workedMs: 0, tokensPerMin: 0 }),
    };
    list.push(item); parents.set(s.sessionId, item);
    if (tr) list.push(...(await buildSubagents(s, tr)));
  }));
  list.push(...(await buildTeammates(parents)));
  list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  return (sessionsCache = { at: Date.now(), value: { missing: false, list } }).value;
}

// ───────────────────────── 사용량 ─────────────────────────
async function readUsage() {
  try {
    const [raw, st] = await Promise.all([fsp.readFile(USAGE_FILE, 'utf8'), fsp.stat(USAGE_FILE)]);
    const [a, ar, b, br] = raw.trim().split('|');
    const win = (p, r) => (p !== undefined && p !== '' && Number.isFinite(Number(p)) ? { pct: Number(p), resetsAt: Number(r) || 0 } : null);
    return { ok: true, fiveHour: win(a, ar), weekly: win(b, br), updatedAt: st.mtimeMs };
  } catch { return { ok: false }; }
}

// ───────────────────────── 일출·일몰·날씨 ─────────────────────────
const sun = { sunrise: 6, sunset: 19, manual: false, ok: false, fetchedAt: 0, weather: 0, theme: process.env.CLAUDE_OFFICE_THEME || 'office' };
const envSun = (process.env.CLAUDE_OFFICE_SUN || '').match(/^(\d{1,2}):(\d{2}),(\d{1,2}):(\d{2})$/);
if (envSun) { sun.manual = true; sun.sunrise = +envSun[1] + +envSun[2] / 60; sun.sunset = +envSun[3] + +envSun[4] / 60; }
let firstFetch;
async function fetchSun() {
  if (sun.manual || sun.theme === 'mine') return;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&daily=sunrise,sunset&current=weather_code&timezone=Asia%2FSeoul&forecast_days=1';
    const j = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json();
    const h = (iso) => { const [hh, mm] = iso.split('T')[1].split(':'); return +hh + +mm / 60; };
    sun.sunrise = h(j.daily.sunrise[0]); sun.sunset = h(j.daily.sunset[0]);
    sun.weather = j.current?.weather_code ?? 0; sun.ok = true; sun.fetchedAt = Date.now();
  } catch { sun.ok = false; }
}
firstFetch = fetchSun();
setInterval(fetchSun, 30 * 60_000).unref();
const sunView = () => ({ sunrise: sun.manual ? sun.sunrise : sun.sunrise, sunset: sun.sunset, manual: sun.manual, ok: sun.ok, fetchedAt: sun.fetchedAt, weather: sun.manual ? 0 : sun.weather });

// ───────────────────────── 창 전환 ─────────────────────────
async function psTable() {
  const out = await sh('ps', ['-axo', 'pid=,ppid=,tty=,comm=']);
  const map = new Map();
  for (const l of out.split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) map.set(+m[1], { pid: +m[1], ppid: +m[2], tty: m[3], comm: m[4] });
  }
  return map;
}
async function envOf(pid) {
  const out = await sh('ps', ['eww', '-p', String(pid), '-o', 'command=']);
  const get = (k) => (out.match(new RegExp(`(?:^|\\s)${k}=(\\S+)`)) || [])[1];
  return { TMUX: get('TMUX'), TMUX_PANE: get('TMUX_PANE'), CMUX_WORKSPACE_ID: get('CMUX_WORKSPACE_ID'), CMUX_PANEL_ID: get('CMUX_PANEL_ID') };
}
const osa = (script) => sh('osascript', ['-e', script], 6000);
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
function outerApp(table, pid) {
  let cur = table.get(pid), app = null;
  while (cur) {
    const m = cur.comm.match(/^(.*?\.app)\//);
    if (m) app = m[1];
    cur = table.get(cur.ppid);
  }
  return app;
}

async function focusSession(sessionId) {
  const { list } = await collectSessions(true);
  const s = list.find((x) => x.sessionId === sessionId);
  if (!s) return { app: null, tab: false };
  let target = s;
  if (s.kind === 'subagent') target = list.find((x) => x.sessionId === s.parentId) || s;
  const table = await psTable();
  const env = await envOf(target.pid);
  const proc = table.get(target.pid);
  let tab = false;

  if (env.TMUX && env.TMUX_PANE) {
    const sock = env.TMUX.split(',')[0];
    await sh('tmux', ['-S', sock, 'select-window', '-t', env.TMUX_PANE]);
    await sh('tmux', ['-S', sock, 'select-pane', '-t', env.TMUX_PANE]);
    const sess = (await sh('tmux', ['-S', sock, 'display-message', '-p', '-t', env.TMUX_PANE, '#{session_name}'])).trim();
    const clients = (await sh('tmux', ['-S', sock, 'list-clients', '-t', sess, '-F', '#{client_pid}'])).split('\n').filter(Boolean);
    for (const c of clients) {
      const app = outerApp(table, +c);
      if (app) { await sh('open', ['-a', app]); return { app: path.basename(app, '.app'), tab: true }; }
    }
    if (target !== s || s.kind === 'teammate') {
      const parent = list.find((x) => x.sessionId === s.parentId);
      if (parent && parent !== s) return focusSession(parent.sessionId);
    }
  }
  if (env.CMUX_WORKSPACE_ID) {
    const a = await sh('cmux', ['select-workspace', '--workspace', env.CMUX_WORKSPACE_ID]);
    const b = env.CMUX_PANEL_ID ? await sh('cmux', ['focus-panel', '--panel', env.CMUX_PANEL_ID]) : '';
    await sh('open', ['-a', 'cmux']);
    return { app: 'cmux', tab: !!(a || b) };
  }
  const app = outerApp(table, target.pid);
  const name = app ? path.basename(app, '.app') : null;
  if (name === 'Ghostty') {
    const r = await osa(`tell application "Ghostty"
  set ts to every terminal whose working directory is "${esc(target.cwd)}"
  if (count of ts) is 1 then
    focus item 1 of ts
    return "ok"
  end if
end tell`);
    tab = r.trim() === 'ok';
  } else if (name === 'iTerm' || name === 'iTerm2') {
    const tty = '/dev/' + (proc?.tty || '');
    const r = await osa(`tell application "iTerm"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${esc(tty)}" then
          select w
          select t
          select s
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell`);
    tab = r.trim() === 'ok';
  }
  if (app) await sh('open', ['-a', app]);
  return { app: name, tab };
}

// ───────────────────────── HTTP ─────────────────────────
const MIME = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const port = server.address().port;
  const host = req.headers.host;
  const send = (code, body, headers = {}) => {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    res.writeHead(code, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-cache', ...headers });
    res.end(isStr ? body : JSON.stringify(body));
  };
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return send(403, 'forbidden');
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) return send(403, 'bad origin');
  }
  const url = new URL(req.url, `http://${host}`);
  const readBody = () => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
  try {
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const r = await collectSessions();
      return send(200, r.list, r.missing ? { 'x-sessions-dir-missing': '1', 'content-type': 'application/json' } : {});
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') return send(200, await readUsage());
    if (req.method === 'GET' && url.pathname === '/api/sun') { await firstFetch; return send(200, sunView()); }
    if (req.method === 'POST' && url.pathname === '/api/sun') {
      const b = await readBody();
      if (b.manual && typeof b.manual.sunrise === 'number' && typeof b.manual.sunset === 'number') {
        sun.manual = true; sun.sunrise = b.manual.sunrise; sun.sunset = b.manual.sunset; sun.weather = 0;
      } else if (b.manual === null) { sun.manual = false; await fetchSun(); }
      return send(200, sunView());
    }
    if (req.method === 'POST' && url.pathname === '/api/theme') {
      const b = await readBody();
      if (typeof b.theme === 'string') sun.theme = b.theme;
      if (sun.theme !== 'mine' && Date.now() - sun.fetchedAt > 30 * 60_000) await fetchSun();
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/focus') {
      const b = await readBody();
      if (typeof b.sessionId !== 'string') return send(400, { error: 'sessionId' });
      return send(200, await focusSession(b.sessionId));
    }
    if (req.method === 'GET') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (/^[\w-]+\.(html|css|js)$/.test(name)) {
        const data = await fsp.readFile(path.join(PUBLIC, name)).catch(() => null);
        if (data) return send(200, data, { 'content-type': MIME[name.split('.').pop()] });
      }
    }
    send(404, 'not found');
  } catch (e) {
    send(500, String(e && e.message));
  }
});

const PORT = process.env.PORT === undefined ? 4317 : Number(process.env.PORT);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Office: http://localhost:${server.address().port}`);
});
