// HTTP-level tests of the running server: Host and Origin checks, static file rules, and the main API routes. node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/server.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-http-'));
const env = { ...process.env, CLAUDE_OFFICE_CLAUDE_DIR: TMP, CLAUDE_OFFICE_SUN: '06:00,19:00', PORT: '0' };
delete env.CLAUDE_OFFICE_EXIT_WITH_PARENT;

const child = spawn(process.execPath, [serverFile], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((resolve, reject) => {
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; const m = buf.match(/http:\/\/localhost:(\d+)/); if (m) resolve(Number(m[1])); });
  child.on('exit', () => reject(new Error('the server exited before it was ready')));
  setTimeout(() => reject(new Error('the server did not start in time')), 10000).unref();
});
test.after(() => { child.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

// node:http allows overriding the Host header, which fetch does not.
function request(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const origin = `http://localhost:${port}`;
const json = (o) => JSON.stringify(o);
const post = (p, o, headers = { origin }) => request('POST', p, { headers: { 'content-type': 'application/json', ...headers }, body: json(o) });

test('Host header: only localhost:<port> and 127.0.0.1:<port> are accepted', async () => {
  assert.equal((await request('GET', '/api/usage')).status, 200);
  assert.equal((await request('GET', '/api/usage', { headers: { host: `127.0.0.1:${port}` } })).status, 200);
  for (const host of ['evil.example', `evil.example:${port}`, 'localhost', `localhost:${port + 1}`, `localhost.evil.example:${port}`]) {
    assert.equal((await request('GET', '/api/usage', { headers: { host } })).status, 403, `Host ${host} should be rejected`);
  }
});

test('POST: requires an Origin equal to the server address', async () => {
  const body = { sessionId: 'nope' };
  assert.equal((await post('/api/focus', body, {})).status, 403, 'no Origin');
  assert.equal((await post('/api/focus', body, { origin: 'http://evil.example' })).status, 403, 'foreign Origin');
  assert.equal((await post('/api/focus', body, { origin: `http://localhost:${port + 1}` })).status, 403, 'other port');
  assert.equal((await post('/api/focus', body, { origin: `http://127.0.0.1:${port}` })).status, 200, '127.0.0.1 Origin');
  assert.equal((await post('/api/sun', { manual: { sunrise: 1, sunset: 2 } }, {})).status, 403, 'sun without Origin');
});

test('POST /api/focus: rejects a missing sessionId and answers for an unknown session', async () => {
  assert.equal((await post('/api/focus', {})).status, 400);
  const r = await post('/api/focus', { sessionId: 'unknown' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { app: null, tab: false });
});

test('static files: only top-level html, css, and js names are served', async () => {
  const index = await request('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.equal((await request('GET', '/panel.js')).status, 200);
  for (const p of ['/../server.mjs', '/%2e%2e/server.mjs', '/server.mjs', '/public/panel.js', '/..%2fserver.mjs', '/panel.js.map', '/nope.js']) {
    assert.equal((await request('GET', p)).status, 404, `${p} should not be served`);
  }
});

test('GET /api/sessions: empty list with the missing-folder header when the sessions folder does not exist', async () => {
  const r = await request('GET', '/api/sessions');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-sessions-dir-missing'], '1');
  assert.deepEqual(JSON.parse(r.body), []);
});

test('/api/sun: reports the manual times and accepts new ones', async () => {
  const a = JSON.parse((await request('GET', '/api/sun')).body);
  assert.equal(a.manual, true);
  assert.equal(a.sunrise, 6);
  const b = JSON.parse((await post('/api/sun', { manual: { sunrise: 5.5, sunset: 20 } })).body);
  assert.equal(b.sunrise, 5.5);
  assert.equal(b.sunset, 20);
});
