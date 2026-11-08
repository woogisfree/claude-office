// Tests for the server's pure logic: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point at a temporary ~/.claude before importing the server, and block the weather lookup with manual values.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-test-'));
process.env.CLAUDE_OFFICE_CLAUDE_DIR = TMP;
process.env.CLAUDE_OFFICE_SUN = '06:00,19:00';
const m = await import('../server/server.mjs');
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const line = (o) => JSON.stringify(o);
const writeTranscript = (name, rows) => { const f = path.join(TMP, name); fs.writeFileSync(f, rows.map(line).join('\n') + '\n'); return f; };

test('parseLines: ignores truncated lines and reads the rest', () => {
  const rows = m.parseLines('{"a":1}\n{"b":\n\n{"c":3}\n');
  assert.deepEqual(rows, [{ a: 1 }, { c: 3 }]);
});

test('cut, stripTags: shorten text and remove tags', () => {
  assert.equal(m.cut('abcdef', 4), 'abc…');
  assert.equal(m.cut('abc', 4), 'abc');
  assert.equal(m.stripTags('<b>안녕</b>   <i>세상</i>'), '안녕 세상');
});

test('describeTool: shows only the file name and cuts long commands to 60 characters', () => {
  assert.equal(m.describeTool('Read', { file_path: '/a/b/c.txt' }), 'Read c.txt');
  assert.equal(m.describeTool('Bash', { command: 'x'.repeat(100) }).length, 60);
  assert.equal(m.describeTool('Foo'), 'Foo');
});

test('summarize: title, last prompt, current activity, and context size', async () => {
  const f = writeTranscript('s1.jsonl', [
    { type: 'ai-title', aiTitle: '테스트 세션' },
    { type: 'user', message: { role: 'user', content: '파일 읽어줘' } },
    { type: 'assistant', message: { role: 'assistant', model: 'claude-x', usage: { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/y.js' } }] } },
  ]);
  const s = await m.summarize(f, 'sess-1');
  assert.equal(s.title, '테스트 세션');
  assert.equal(s.lastPrompt, '파일 읽어줘');
  assert.equal(s.activity, 'Read y.js');
  assert.equal(s.ctxTokens, 115);
  assert.equal(s.model, 'claude-x');
});

test('summarize: counts consecutive tool failures, ignores user rejections, and resets to 0 on success', async () => {
  const res = (id, is_error, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] } });
  const f = writeTranscript('s2.jsonl', [
    res('a', true, 'boom'), res('b', true, 'boom'),
    res('c', true, "The user doesn't want to proceed"),
  ]);
  assert.equal((await m.summarize(f, 'sess-2')).failStreak, 2);
  const f2 = writeTranscript('s3.jsonl', [res('a', true, 'boom'), res('b', false, 'ok')]);
  assert.equal((await m.summarize(f2, 'sess-3')).failStreak, 0);
});

test('updateStats: applies the 1.25, 0.1, and 5 weights and counts each message id once', async () => {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 36 * 3600_000).toISOString();
  const usage = { input_tokens: 100, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }; // 100 + 125 + 100 + 50
  const a = (id, ts) => ({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', stop_reason: 'end_turn', usage, content: [] } });
  const f = writeTranscript('stats.jsonl', [a('m1', now), a('m1', now), a('m0', yesterday)]);
  const view = m.statsView(await m.updateStats(f));
  assert.equal(view.tokensToday, 375);
  assert.equal(view.tokensPerMin, 75); // the recent 5-minute total of 375 divided by 5
});

test('updateStats: does not recount already-read content when the file keeps growing', async () => {
  const now = new Date().toISOString();
  const row = (id) => ({ type: 'assistant', timestamp: now, message: { id, role: 'assistant', usage: { output_tokens: 10 }, content: [] } });
  const f = writeTranscript('grow.jsonl', [row('g1')]);
  assert.equal(m.statsView(await m.updateStats(f)).tokensToday, 50);
  fs.appendFileSync(f, line(row('g2')) + '\n');
  assert.equal(m.statsView(await m.updateStats(f)).tokensToday, 100);
});

test('readUsage: reads the status line cache, returns null for an empty window, and ok:false when the file is missing', async () => {
  const file = path.join(TMP, '.statusline-ratelimit-cache');
  assert.deepEqual(await m.readUsage(), { ok: false });
  fs.writeFileSync(file, '72|1794100000|87|1794500000\n');
  let u = await m.readUsage();
  assert.equal(u.ok, true);
  assert.deepEqual(u.fiveHour, { pct: 72, resetsAt: 1794100000 });
  assert.deepEqual(u.weekly, { pct: 87, resetsAt: 1794500000 });
  fs.writeFileSync(file, '|||\n');
  u = await m.readUsage();
  assert.equal(u.fiveHour, null);
  assert.equal(u.weekly, null);
});

test('collectSessions: reports missing when the sessions folder does not exist', async () => {
  const r = await m.collectSessions(true);
  assert.equal(r.missing, true);
  assert.deepEqual(r.list, []);
});

test('forecastUrl, parseForecast: query by city coordinates and read local sunrise, sunset, and the UTC offset', () => {
  const url = new URL(m.forecastUrl(40.7128, -74.006));
  assert.equal(url.searchParams.get('latitude'), '40.7128');
  assert.equal(url.searchParams.get('longitude'), '-74.006');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  const f = m.parseForecast({ utc_offset_seconds: -18000, daily: { sunrise: ['2026-11-08T06:30'], sunset: ['2026-11-08T16:45'] }, current: { weather_code: 61 } });
  assert.deepEqual(f, { sunrise: 6.5, sunset: 16.75, weather: 61, utcOffset: -18000 });
  const g = m.parseForecast({ daily: { sunrise: ['2026-11-08T07:00'], sunset: ['2026-11-08T18:00'] } });
  assert.equal(g.weather, 0);
  assert.equal(g.utcOffset, null);
});

test('CITIES: has the five cities and their coordinates are in range', () => {
  assert.deepEqual(Object.keys(m.CITIES), ['seoul', 'tokyo', 'newyork', 'london', 'sydney']);
  for (const [lat, lon] of Object.values(m.CITIES)) assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
});

test('buildSubagents: adds every subagent transcript of today, finished ones included, to the parent totals', async () => {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 36 * 3600_000).toISOString();
  const row = (id, ts, out) => ({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', usage: { output_tokens: out }, content: [] } });
  const transcript = path.join(TMP, 'parent.jsonl');
  const sub = path.join(TMP, 'parent', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const write = (name, rows) => fs.writeFileSync(path.join(sub, name), rows.map(line).join('\n') + '\n');
  // a1 is still running, a2 has finished (no longer listed, but its tokens still count), a3 only has yesterday's lines.
  write('a1.jsonl', [row('x1', now, 10)]);
  fs.writeFileSync(path.join(sub, 'a1.meta.json'), line({ description: 'running agent' }));
  write('a2.jsonl', [row('x2', now, 20)]);
  fs.writeFileSync(path.join(sub, 'a2.meta.json'), line({ description: 'done agent', finished: true }));
  write('a3.jsonl', [row('x3', yesterday, 30)]);
  const r = await m.buildSubagents({ sessionId: 'parent', pid: 1, cwd: '/x' }, transcript);
  assert.equal(r.tokensToday, 150); // (10 + 20) output tokens, weighted by 5
  assert.deepEqual(r.items.map((i) => [i.name, i.tokensToday]), [['running agent', 50]]);
});

test('updateStats: a large transcript is not read from the start, and the result matches a full read', async () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 72 * 3600_000).toISOString();
  const row = (id, ts, out, pad = '') => line({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', usage: { output_tokens: out }, content: [], pad } });
  // About 20 MB of old lines (some of them huge), then today's lines.
  const parts = [];
  const filler = 'x'.repeat(2000);
  for (let i = 0; i < 10000; i++) parts.push(row('old' + i, old, 1000, filler));
  parts.push(row('huge', old, 1000, 'y'.repeat(300000)));
  parts.push(row('t1', now, 10), row('t2', now, 20));
  const f = path.join(TMP, 'big.jsonl');
  fs.writeFileSync(f, parts.join('\n') + '\n');
  assert.ok(fs.statSync(f).size > m.SEEK_MIN_BYTES, 'the test file must exceed the seek threshold');
  const fh = await fs.promises.open(f, 'r');
  let start;
  try { start = await m.findTodayStart(fh, fs.statSync(f).size, new Date().setHours(0, 0, 0, 0)); } finally { await fh.close(); }
  assert.ok(start > 10 * 1024 * 1024, `the search should skip most of the file (start=${start})`);
  assert.equal(fs.readFileSync(f).subarray(start - 1, start).toString(), '\n', 'the offset must be the start of a line');
  assert.equal(m.statsView(await m.updateStats(f)).tokensToday, 150); // (10 + 20) output tokens, weighted by 5
});

test('findTodayStart: returns 0 when the whole file is from today', async () => {
  const now = new Date().toISOString();
  const f = path.join(TMP, 'today.jsonl');
  fs.writeFileSync(f, Array.from({ length: 5000 }, (_, i) => line({ type: 'assistant', timestamp: now, message: { id: 'a' + i, usage: { output_tokens: 1 }, pad: 'z'.repeat(500) } })).join('\n') + '\n');
  const fh = await fs.promises.open(f, 'r');
  try { assert.equal(await m.findTodayStart(fh, fs.statSync(f).size, new Date().setHours(0, 0, 0, 0)), 0); } finally { await fh.close(); }
});

test('findTranscript: a session that is not found does not block the search for another one', async () => {
  const projects = path.join(TMP, 'projects', 'some-other-folder');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, 'found-id.jsonl'), '');
  assert.equal(await m.findTranscript('missing-id', '/no/such/cwd'), null); // starts its own 30-second limit
  assert.equal(await m.findTranscript('found-id', '/no/such/cwd'), path.join(projects, 'found-id.jsonl'));
});
