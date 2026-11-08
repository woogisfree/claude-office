// 서버의 순수 로직 테스트: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 서버를 불러오기 전에 임시 ~/.claude 를 지정하고, 날씨 조회는 수동 값으로 막는다.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-test-'));
process.env.CLAUDE_OFFICE_CLAUDE_DIR = TMP;
process.env.CLAUDE_OFFICE_SUN = '06:00,19:00';
const m = await import('../server/server.mjs');
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const line = (o) => JSON.stringify(o);
const writeTranscript = (name, rows) => { const f = path.join(TMP, name); fs.writeFileSync(f, rows.map(line).join('\n') + '\n'); return f; };

test('parseLines: 잘린 줄은 무시하고 나머지는 읽는다', () => {
  const rows = m.parseLines('{"a":1}\n{"b":\n\n{"c":3}\n');
  assert.deepEqual(rows, [{ a: 1 }, { c: 3 }]);
});

test('cut, stripTags: 길이를 줄이고 태그를 지운다', () => {
  assert.equal(m.cut('abcdef', 4), 'abc…');
  assert.equal(m.cut('abc', 4), 'abc');
  assert.equal(m.stripTags('<b>안녕</b>   <i>세상</i>'), '안녕 세상');
});

test('describeTool: 파일은 이름만, 긴 명령은 60자로 줄인다', () => {
  assert.equal(m.describeTool('Read', { file_path: '/a/b/c.txt' }), 'Read c.txt');
  assert.equal(m.describeTool('Bash', { command: 'x'.repeat(100) }).length, 60);
  assert.equal(m.describeTool('Foo'), 'Foo');
});

test('summarize: 제목, 마지막 프롬프트, 지금 하는 일, 컨텍스트 크기', async () => {
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

test('summarize: 도구 실패는 연속으로 세고 사용자 거절은 세지 않으며 성공하면 0으로 돌아간다', async () => {
  const res = (id, is_error, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] } });
  const f = writeTranscript('s2.jsonl', [
    res('a', true, 'boom'), res('b', true, 'boom'),
    res('c', true, "The user doesn't want to proceed"),
  ]);
  assert.equal((await m.summarize(f, 'sess-2')).failStreak, 2);
  const f2 = writeTranscript('s3.jsonl', [res('a', true, 'boom'), res('b', false, 'ok')]);
  assert.equal((await m.summarize(f2, 'sess-3')).failStreak, 0);
});

test('updateStats: 가중치 1.25, 0.1, 5를 적용하고 같은 메시지 id는 한 번만 센다', async () => {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 36 * 3600_000).toISOString();
  const usage = { input_tokens: 100, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }; // 100 + 125 + 100 + 50
  const a = (id, ts) => ({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', stop_reason: 'end_turn', usage, content: [] } });
  const f = writeTranscript('stats.jsonl', [a('m1', now), a('m1', now), a('m0', yesterday)]);
  const view = m.statsView(await m.updateStats(f));
  assert.equal(view.tokensToday, 375);
  assert.equal(view.tokensPerMin, 75); // 최근 5분 합계 375를 5로 나눈 값
});

test('updateStats: 파일이 이어서 길어져도 이미 읽은 부분은 다시 세지 않는다', async () => {
  const now = new Date().toISOString();
  const row = (id) => ({ type: 'assistant', timestamp: now, message: { id, role: 'assistant', usage: { output_tokens: 10 }, content: [] } });
  const f = writeTranscript('grow.jsonl', [row('g1')]);
  assert.equal(m.statsView(await m.updateStats(f)).tokensToday, 50);
  fs.appendFileSync(f, line(row('g2')) + '\n');
  assert.equal(m.statsView(await m.updateStats(f)).tokensToday, 100);
});

test('readUsage: 상태 표시줄 캐시를 읽고, 빈 창은 null, 파일이 없으면 ok:false', async () => {
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

test('collectSessions: 세션 폴더가 없으면 missing으로 알린다', async () => {
  const r = await m.collectSessions(true);
  assert.equal(r.missing, true);
  assert.deepEqual(r.list, []);
});
