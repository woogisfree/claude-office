// Token and working-time statistics read incrementally from transcripts.
import fsp from 'node:fs/promises';
import { CHUNK } from './config.mjs';

// ───────────────────────── Token stats ─────────────────────────
const statsState = new Map(); // file -> {pos, day, tokens, seen:Set, workMs, lastReq, lastEnd, events:[[ts,tokens]], touched}
const statsLocks = new Map();
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export async function updateStats(file) {
  const prev = statsLocks.get(file) || Promise.resolve();
  const next = prev.then(() => doUpdateStats(file)).catch(() => {});
  statsLocks.set(file, next);
  await next;
  return statsState.get(file);
}
// Files larger than this are not read from the start on the first scan: the offset of today's first line is searched for instead.
export const SEEK_MIN_BYTES = 16 * 1024 * 1024;
// Binary-searches a transcript for where today's lines begin and returns a line-aligned byte offset (0 when it cannot tell).
// Lines are appended in time order, so everything before the returned offset is older than `midnight`.
export async function findTodayStart(fh, size, midnight) {
  const WINDOW = 16 * 1024, STOP = 256 * 1024;
  // Timestamp of the first complete line that starts after `off` and carries a timestamp, or null when the window holds none (for example one huge line).
  const tsAfter = async (off) => {
    const buf = Buffer.alloc(Math.min(WINDOW, size - off));
    const { bytesRead } = await fh.read(buf, 0, buf.length, off);
    const lines = buf.toString('utf8', 0, bytesRead).split('\n');
    for (const l of lines.slice(1, -1)) {
      const m = l.match(/"timestamp":"([^"]+)"/);
      if (m) { const t = Date.parse(m[1]); if (Number.isFinite(t)) return t; }
    }
    return null;
  };
  let lo = 0, hi = size;
  while (hi - lo > STOP) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await tsAfter(mid);
    if (t === null) break; // no information here, so keep what is already proven
    if (t < midnight) lo = mid; else hi = mid;
  }
  if (lo === 0) return 0;
  // Move forward to the start of the next line, because lo can fall in the middle of one.
  for (let off = lo, scanned = 0; off < size && scanned < 16 * 1024 * 1024; off += 64 * 1024, scanned += 64 * 1024) {
    const buf = Buffer.alloc(Math.min(64 * 1024, size - off));
    const { bytesRead } = await fh.read(buf, 0, buf.length, off);
    const nl = buf.subarray(0, bytesRead).indexOf(10);
    if (nl >= 0) return off + nl + 1;
  }
  return 0;
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
    if (st.pos === 0 && stat.size > SEEK_MIN_BYTES) st.pos = await findTodayStart(fh, stat.size, midnight);
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
        // Skip lines from before today without parsing the JSON.
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
export function statsView(st) {
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
