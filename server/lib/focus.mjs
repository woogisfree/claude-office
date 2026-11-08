// Bringing the terminal or chat of a session to the front.
import path from 'node:path';
import { sh } from './util.mjs';
import { collectSessions, DESKTOP_ID } from './sessions.mjs';

// ───────────────────────── Window focus ─────────────────────────
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

export async function focusSession(sessionId) {
  const { list } = await collectSessions(true);
  const s = list.find((x) => x.sessionId === sessionId);
  if (!s) return { app: null, tab: false };
  let target = s;
  if (s.kind === 'subagent') target = list.find((x) => x.sessionId === s.parentId) || s;
  // Desktop app session: open its chat through the claude://code/continue link the app handles. (An internal app route that is not in the official docs.)
  if (target.entrypoint === 'claude-desktop' && DESKTOP_ID.test(target.hostSessionId || '')) {
    await sh('open', [`claude://code/continue?session=${encodeURIComponent(target.hostSessionId)}&source=claude_office`]);
    return { app: 'Claude', tab: true };
  }
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
