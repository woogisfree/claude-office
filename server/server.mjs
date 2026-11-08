// Claude Office local server: a dependency-free node:http server that reads ~/.claude and serves session info.
// The data logic lives in lib/; this file holds the HTTP layer and startup.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSessions } from './lib/sessions.mjs';
import { readUsage } from './lib/usage.mjs';
import { CITIES, sun, fetchSun, sunView, sunReady } from './lib/sun.mjs';
import { focusSession } from './lib/focus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');

// ───────────────────────── HTTP ─────────────────────────
const MIME = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const port = server.address().port;
  const host = req.headers.host;
  const send = (code, body, headers = {}) => {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    res.writeHead(code, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-cache', ...headers });
    res.end(isStr ? body : JSON.stringify(body));
  };
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return send(403, 'forbidden');
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) return send(403, 'bad origin');
  }
  const url = new URL(req.url, `http://${host}`);
  const readBody = () => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
  try {
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const r = await collectSessions();
      return send(200, r.list, r.missing ? { 'x-sessions-dir-missing': '1', 'content-type': 'application/json' } : {});
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') return send(200, await readUsage());
    if (req.method === 'GET' && url.pathname === '/api/sun') { await sunReady(); return send(200, sunView()); }
    if (req.method === 'POST' && url.pathname === '/api/sun') {
      const b = await readBody();
      if (b.manual && typeof b.manual.sunrise === 'number' && typeof b.manual.sunset === 'number') {
        sun.manual = true; sun.sunrise = b.manual.sunrise; sun.sunset = b.manual.sunset; sun.weather = 0;
      } else if (b.manual === null) { sun.manual = false; await fetchSun(); }
      return send(200, sunView());
    }
    if (req.method === 'POST' && url.pathname === '/api/location') {
      const b = await readBody();
      if (typeof b.city === 'string' && CITIES[b.city] && b.city !== sun.city) { sun.city = b.city; sun.ok = false; await fetchSun(); }
      return send(200, sunView());
    }
    if (req.method === 'POST' && url.pathname === '/api/theme') {
      const b = await readBody();
      if (typeof b.theme === 'string') sun.theme = b.theme;
      if (sun.theme !== 'mine' && Date.now() - sun.fetchedAt > 30 * 60_000) await fetchSun();
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/focus') {
      const b = await readBody();
      if (typeof b.sessionId !== 'string') return send(400, { error: 'sessionId' });
      return send(200, await focusSession(b.sessionId));
    }
    if (req.method === 'GET') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (/^[\w-]+\.(html|css|js)$/.test(name)) {
        const data = await fsp.readFile(path.join(PUBLIC, name)).catch(() => null);
        if (data) return send(200, data, { 'content-type': MIME[name.split('.').pop()] });
      }
    }
    send(404, 'not found');
  } catch (e) {
    send(500, String(e && e.message));
  }
});

// Only open the server when run directly, not when tests import this file.
const isMain = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const PORT = process.env.PORT === undefined ? 4317 : Number(process.env.PORT);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Claude Office: http://localhost:${server.address().port}`);
  });
  // The app sets this so a crashed or force-quit app does not leave the server running.
  if (process.env.CLAUDE_OFFICE_EXIT_WITH_PARENT === '1') {
    const parent = process.ppid;
    setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 2000).unref?.();
  }
}

// The tests import everything from here.
export { parseLines, cut, stripTags } from './lib/util.mjs';
export { describeTool, summarize, findTranscript, contextLimit } from './lib/transcripts.mjs';
export { updateStats, statsView, findTodayStart, SEEK_MIN_BYTES } from './lib/stats.mjs';
export { collectSessions, buildSubagents, subagentStats, isSameProcess, listProcessArgs } from './lib/sessions.mjs';
export { readUsage } from './lib/usage.mjs';
export { forecastUrl, parseForecast, CITIES } from './lib/sun.mjs';
