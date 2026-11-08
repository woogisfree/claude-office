// Finding a session's transcript and summarizing its tail: title, last prompt, current activity, context size, and tool failures.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR } from './config.mjs';
import { readTail, parseLines, exists, cut, stripTags } from './util.mjs';

// ───────────────────────── Finding transcripts ─────────────────────────
const transcriptCache = new Map(); // sessionId -> path
const lastFullScan = new Map(); // sessionId -> time of the last scan of every project folder (each session has its own 30-second limit)
export async function findTranscript(sessionId, cwd) {
  const cached = transcriptCache.get(sessionId);
  if (cached && (await exists(cached))) return cached;
  const dir = path.join(PROJECTS_DIR, String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-'));
  const direct = path.join(dir, `${sessionId}.jsonl`);
  if (await exists(direct)) { transcriptCache.set(sessionId, direct); return direct; }
  if (Date.now() - (lastFullScan.get(sessionId) || 0) < 30_000) return null;
  lastFullScan.set(sessionId, Date.now());
  try {
    for (const d of await fsp.readdir(PROJECTS_DIR)) {
      const p = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if (await exists(p)) { transcriptCache.set(sessionId, p); return p; }
    }
  } catch { /* folder missing */ }
  return null;
}

// ───────────────────────── Session summary ─────────────────────────
const titleMemo = new Map();

export function describeTool(name, input = {}) {
  const target = input.file_path || input.description || input.command || input.pattern || input.query || input.url || input.skill || '';
  const t = typeof target === 'string' ? (input.file_path ? path.basename(target) : target) : '';
  return cut(t ? `${name} ${t}` : name, 60);
}

// Context window of a model: 200k for older models (Claude 3, Haiku 4.5, Sonnet 4 and 4.5, Opus 4, 4.1 and 4.5), 1M for newer ones.
// A session that already holds more than 200k tokens must be on the 1M window, whatever the model name says.
const SMALL_WINDOW_MODEL = /claude-(3-|haiku-4-5|sonnet-4(?!-[6-9])|opus-4(?!-[6-9]))/;
export function contextLimit(model, ctxTokens = 0) { return ctxTokens > 200000 || !SMALL_WINDOW_MODEL.test(model || '') ? 1e6 : 2e5; }

// The last summary of each transcript, reused while the file has the same size and modification time.
// The UI and the app both poll every couple of seconds, but most transcripts do not change between two polls.
const summaryCache = new Map(); // file -> {size, mtimeMs, value}
const SUMMARY_CACHE_MAX = 500;

export async function summarize(file, sessionId) {
  const stat = await fsp.stat(file);
  const hit = summaryCache.get(file);
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return { ...hit.value };
  const value = await summarizeFile(file, sessionId);
  summaryCache.delete(file); // re-insert so the oldest entry is always first
  summaryCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, value });
  if (summaryCache.size > SUMMARY_CACHE_MAX) summaryCache.delete(summaryCache.keys().next().value);
  return { ...value };
}

async function summarizeFile(file, sessionId) {
  const { text } = await readTail(file);
  const rows = parseLines(text);
  let title = titleMemo.get(sessionId) || '';
  let lastPrompt = '';
  let activity = '';
  let ctxTokens = 0;
  let model = '';
  let failStreak = 0;

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
            const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
            const rejected = /user (doesn't want|rejected)|interrupted|request interrupted/i.test(txt);
            if (b.is_error && !rejected) failStreak++;
            else if (!b.is_error) failStreak = 0;
            activity = '@result';
          }
        }
      }
    } else if (r.type === 'assistant' && msg.role === 'assistant') {
      if (msg.model && msg.model !== '<synthetic>') model = msg.model;
      const u = msg.usage;
      if (u) ctxTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
      for (const b of msg.content || []) {
        if (b.type === 'tool_use') activity = describeTool(b.name, b.input);
        else if (b.type === 'thinking') activity = '@thinking';
        else if (b.type === 'text') activity = '@writing';
      }
    }
  }
  if (title) titleMemo.set(sessionId, title);
  return { title, lastPrompt, activity, ctxTokens, model, failStreak };
}
