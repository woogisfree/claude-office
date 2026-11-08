// Route tests: node --test
// Check that every route is horizontal or vertical only and never crosses another employee's desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/public');
const stage = { clientWidth: 1200, clientHeight: 800 };
const el = (extra = {}) => ({ getContext: () => ({}), ...extra });
const ctx = vm.createContext({
  document: { querySelector: (sel) => (sel === '#stage' ? stage : el()) },
  location: { search: '' }, URLSearchParams, window: {}, Math, Number, Array, Set, Map,
});
for (const f of ['layout.js', 'routes.js']) vm.runInContext(fs.readFileSync(path.join(pub, f), 'utf8'), ctx);

const SIZES = [[900, 600], [1100, 760], [1280, 860], [1728, 1000], [1900, 620], [2400, 1200]];
const setup = (w, h, count) => {
  stage.clientWidth = w; stage.clientHeight = h;
  vm.runInContext(`baseZoom = 3; computeLayout(${count})`, ctx);
};
const run = (code) => vm.runInContext(code, ctx);

// The body area of a desk (monitor, desk top, and recliner included). The lower lane (laneY) and the side path are outside it.
const bodyRect = (d, g) => ({ x0: d.x, x1: d.x - g + run('CELL_W') - 1, y0: d.y, y1: d.y + run('CELL_H') - 6 });
const crosses = (a, b, r) => {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return x1 > r.x0 && x0 < r.x1 && y1 > r.y0 && y0 < r.y1;
};

function check(label, start, route, ownIdx, count) {
  const g = run('GUTTER');
  const pts = [start, ...route];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, `${label}: segment ${i} is diagonal (${a.x},${a.y})→(${b.x},${b.y})`);
    for (let k = 0; k < count; k++) {
      const d = run(`deskPos(${k})`);
      // Your own desk has paths in to the seat (x+11) and the recliner (x+68), so only the desk body between them is forbidden.
      const r = k === ownIdx ? { x0: d.x + 12, x1: d.x + 66, y0: d.y, y1: d.y + run('CELL_H') - 6 } : bodyRect(d, g);
      assert.ok(!crosses(a, b, r), `${label}: segment ${i} crosses desk ${k}`);
    }
  }
}

test('entry, rest, and leave routes are all axis-aligned and avoid other desks', () => {
  for (const [w, h] of SIZES) for (const count of [1, 5, 12]) {
    setup(w, h, count);
    const desks = run('L.desks');
    for (let i = 0; i < Math.min(count, desks); i++) {
      const label = `${w}x${h} count=${count} desk=${i}`;
      for (const status of ['busy', 'idle']) {
        const e = run(`({ desk: ${i}, data: { status: '${status}' } })`);
        ctx.__e = e;
        const head = run('entryPath(__e)'), tail = run('entryTail(__e)');
        check(`${label} entry (${status})`, run('doorPos()'), head.concat(tail), i, count);
      }
      const d = run(`deskPos(${i})`);
      check(`${label} going to rest`, run(`seatPos(deskPos(${i}))`), run(`restRoute(deskPos(${i}))`), i, count);
      const out = (rest) => run(`exitRoute(deskPos(${i}), seatPos(deskPos(${i})), ${rest}, ${d.x + 68})`);
      check(`${label} leaving from the seat`, run(`seatPos(deskPos(${i}))`), out(false), i, count);
      check(`${label} leaving from the recliner`, run(`restPos(deskPos(${i}))`), out(true), i, count);
    }
  }
});

test('if the status changes during entry, the employee reaches the new destination from any position without diagonals or crossing desks', () => {
  for (const [w, h] of [[1280, 860], [1900, 620]]) {
    setup(w, h, 6);
    for (let i = 0; i < 6; i++) {
      const d = run(`deskPos(${i})`);
      const lane = run(`laneY(deskPos(${i}))`), sx = run(`sideX(deskPos(${i}))`), s = run(`seatPos(deskPos(${i}))`);
      // Typical positions while walking: side path entrance, middle of the side path, horizontal leg to the seat, vertical leg to the recliner, middle of the lower lane
      const spots = [
        { x: sx, y: lane }, { x: sx, y: (lane + s.y) / 2 }, { x: (sx + s.x) / 2, y: s.y },
        { x: d.x + 68, y: (lane + d.y + 36) / 2 }, { x: (sx + d.x + 68) / 2, y: lane },
      ];
      for (const [from, to] of [['seat', 'idle'], ['rest', 'busy']]) for (const p of spots) {
        const e = run(`({ desk: ${i}, dest: '${from}', data: { status: '${to}' } })`);
        e.x = p.x; e.y = p.y; ctx.__e = e;
        run('replanEntry(__e)');
        assert.equal(e.dest, to === 'idle' ? 'rest' : 'seat');
        const end = e.path[e.path.length - 1];
        const want = to === 'idle' ? run(`restPos(deskPos(${i}))`) : s;
        assert.ok(end.x === want.x && end.y === want.y, `${w}x${h} desk=${i}: did not reach the new destination`);
        check(`${w}x${h} desk=${i} ${from}→${to} position (${p.x},${p.y})`, p, e.path, i, 6);
      }
    }
  }
});
