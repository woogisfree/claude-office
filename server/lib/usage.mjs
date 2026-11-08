// The 5-hour and weekly usage written by the Claude Code status line script.
import fsp from 'node:fs/promises';
import { USAGE_FILE } from './config.mjs';

// ───────────────────────── Usage ─────────────────────────
export async function readUsage() {
  try {
    const [raw, st] = await Promise.all([fsp.readFile(USAGE_FILE, 'utf8'), fsp.stat(USAGE_FILE)]);
    const [a, ar, b, br] = raw.trim().split('|');
    const win = (p, r) => (p !== undefined && p !== '' && Number.isFinite(Number(p)) ? { pct: Number(p), resetsAt: Number(r) || 0 } : null);
    return { ok: true, fiveHour: win(a, ar), weekly: win(b, br), updatedAt: st.mtimeMs };
  } catch { return { ok: false }; }
}
