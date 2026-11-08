// Auto clock-out: a session that has been resting for a long time leaves the office, but its process is left alone.
// It comes back by itself as soon as the session works or asks for approval again, because it is judged from the latest list every time.
// This file has no dependency on the page, so the tests can run it directly.

// Splits the session list into the sessions that stay in the office and the ones that went home.
// A session goes home only when it has been idle without a break for `hours` hours (`statusUpdatedAt` is when the current status began).
// Waiting for approval never counts as resting, because it needs the user. A session with a working subagent or teammate stays too.
// The children of a session that went home leave with it, and they are not listed as sessions of their own.
function splitGone(list, hours, now = Date.now()) {
  if (!(hours > 0)) return { present: list, gone: [] };
  const limit = hours * 3600e3;
  const awakeParents = new Set(list.filter((s) => s.parentId && s.status !== 'idle').map((s) => s.parentId));
  const gone = [];
  const goneIds = new Set();
  for (const s of list) {
    if (s.parentId || s.status !== 'idle' || !s.statusUpdatedAt || awakeParents.has(s.sessionId)) continue;
    if (now - s.statusUpdatedAt >= limit) { gone.push(s); goneIds.add(s.sessionId); }
  }
  if (!gone.length) return { present: list, gone };
  return { present: list.filter((s) => !goneIds.has(s.sessionId) && !goneIds.has(s.parentId)), gone };
}
