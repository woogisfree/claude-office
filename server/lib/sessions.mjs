// Running sessions, their subagents, and tmux teammates, assembled from ~/.claude and the process list.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SESSIONS_DIR, TEAMS_DIR, WORKING_STALE_MS } from './config.mjs';
import { sh } from './util.mjs';
import { findTranscript, summarize, contextLimit } from './transcripts.mjs';
import { updateStats, statsView, startOfToday } from './stats.mjs';

// ───────────────────────── Sessions, subagents, teammates ─────────────────────────
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// A session file records when its process started (procStart, written in UTC). If the process now running under that pid started at
// another time, the pid was reused after the session ended without cleaning up its file, so the session is not alive.
// Local time (how ps prints it) and UTC are both accepted, and anything unreadable counts as a match, so a real session is never hidden by mistake.
export function isSameProcess(procStart, psStart) {
  if (!procStart || !psStart) return true;
  const norm = (x) => String(x).replace(/\s+/g, ' ').trim();
  const actual = Date.parse(norm(psStart));
  const recorded = [Date.parse(norm(procStart)), Date.parse(norm(procStart) + ' UTC')];
  if (!Number.isFinite(actual) || recorded.some((t) => !Number.isFinite(t))) return true;
  return recorded.some((t) => Math.abs(t - actual) <= 5000);
}
const verifiedPid = new Map(); // `${sessionId}:${pid}` -> boolean, checked once because a running process keeps its start time
async function processStarts(pids) {
  const map = new Map();
  const out = await sh('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')]);
  for (const l of out.split('\n')) { const m = l.match(/^\s*(\d+)\s+(.*)$/); if (m) map.set(Number(m[1]), m[2]); }
  return map;
}

async function readSessionFiles() {
  let names;
  try { names = await fsp.readdir(SESSIONS_DIR); } catch { return null; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR, n), 'utf8'));
      if (j && j.pid && j.sessionId && alive(j.pid)) out.push(j);
    } catch { /* file is being written */ }
  }
  const unchecked = out.filter((j) => j.procStart && !verifiedPid.has(`${j.sessionId}:${j.pid}`));
  if (unchecked.length) {
    const starts = await processStarts(unchecked.map((j) => j.pid));
    for (const j of unchecked) verifiedPid.set(`${j.sessionId}:${j.pid}`, isSameProcess(j.procStart, starts.get(j.pid)));
  }
  return out.filter((j) => verifiedPid.get(`${j.sessionId}:${j.pid}`) !== false);
}

// Subagents write to their own transcripts, so the parent's transcript never contains their usage.
// Sum today's tokens over every subagent transcript, including finished ones, so the parent's totals and token rate include them.
export async function subagentStats(sub, names) {
  const views = new Map(); // agent id -> {tokensToday, tokensPerMin}
  const midnight = startOfToday();
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const file = path.join(sub, n);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs < midnight) continue; // nothing written today
    const v = statsView(await updateStats(file).catch(() => null));
    views.set(n.replace(/\.jsonl$/, ''), v);
  }
  let tokensToday = 0, tokensPerMin = 0;
  for (const v of views.values()) { tokensToday += v.tokensToday; tokensPerMin += v.tokensPerMin; }
  return { views, tokensToday, tokensPerMin };
}

export async function buildSubagents(parent, transcript) {
  const dir = transcript.replace(/\.jsonl$/, '');
  const sub = path.join(dir, 'subagents');
  let names; try { names = await fsp.readdir(sub); } catch { return { items: [], tokensToday: 0, tokensPerMin: 0 }; }
  const stats = await subagentStats(sub, names);
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
        status: Date.now() - stat.mtimeMs < 20_000 ? 'busy' : 'idle', activity: sum.activity || '', ctxTokens: sum.ctxTokens || 0, ctxLimit: contextLimit(sum.model, sum.ctxTokens), model: sum.model || '',
        failStreak: sum.failStreak || 0, lastPrompt: '', title: '', workedMs: 0,
        tokensToday: stats.views.get(id)?.tokensToday || 0, tokensPerMin: stats.views.get(id)?.tokensPerMin || 0,
      });
    } catch { /* skipped */ }
  }
  return { items: out, tokensToday: stats.tokensToday, tokensPerMin: stats.tokensPerMin };
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
    } catch { /* no settings */ }
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
export async function collectSessions(force = false) {
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
      entrypoint: s.entrypoint || '', hostSessionId: DESKTOP_ID.test(s.hostSessionId || '') ? s.hostSessionId : '',
      name: s.name || sum.title || path.basename(s.cwd || '') || s.sessionId.slice(0, 8),
      title: sum.title || '', lastPrompt: sum.lastPrompt || '',
      status: waiting ? 'waiting' : s.status === 'busy' ? 'busy' : 'idle',
      waitingFor: s.waitingFor || '', statusUpdatedAt: s.statusUpdatedAt || 0,
      activity: sum.activity || '', ctxTokens: sum.ctxTokens || 0, ctxLimit: contextLimit(sum.model, sum.ctxTokens), model: sum.model || '', failStreak: sum.failStreak || 0,
      ...(stats || { tokensToday: 0, workedMs: 0, tokensPerMin: 0 }),
    };
    list.push(item); parents.set(s.sessionId, item);
    if (tr) {
      const sub = await buildSubagents(s, tr);
      item.tokensToday += sub.tokensToday; item.tokensPerMin += sub.tokensPerMin;
      list.push(...sub.items);
    }
  }));
  list.push(...(await buildTeammates(parents)));
  list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  return (sessionsCache = { at: Date.now(), value: { missing: false, list } }).value;
}

// Format of Claude desktop app session ids. If a session file's hostSessionId matches, the app can jump straight to that session.
export const DESKTOP_ID = /^local_[A-Za-z0-9-]{1,64}$/;
