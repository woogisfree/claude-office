// Small helpers: running commands, reading transcript lines, and shortening text.
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { TAIL_BYTES } from './config.mjs';

export const sh = (cmd, args, timeout = 4000) =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout))),
  );


// ───────────────────────── File reading helpers ─────────────────────────
export async function readTail(file, bytes = TAIL_BYTES) {
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
export const parseLines = (text) => {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* ignore truncated lines */ }
  }
  return out;
};

export const exists = (p) => fsp.access(p).then(() => true, () => false);

export const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
