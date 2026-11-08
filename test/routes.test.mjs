// 이동 경로 테스트: node --test
// 모든 경로가 가로나 세로로만 이어지고, 다른 직원의 책상을 가로지르지 않는지 확인한다.
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

// 다른 책상의 본체(모니터와 책상 윗면, 리클라이너 포함) 영역이다. 아래 통로(laneY)와 옆길은 이 영역 밖이다.
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
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, `${label}: ${i}번째 구간이 대각선 (${a.x},${a.y})→(${b.x},${b.y})`);
    for (let k = 0; k < count; k++) {
      const d = run(`deskPos(${k})`);
      // 자기 책상은 자리(x+11)와 리클라이너(x+68)로 드나드는 길이 있으므로, 둘 사이의 책상 본체만 금지한다.
      const r = k === ownIdx ? { x0: d.x + 12, x1: d.x + 66, y0: d.y, y1: d.y + run('CELL_H') - 6 } : bodyRect(d, g);
      assert.ok(!crosses(a, b, r), `${label}: ${i}번째 구간이 ${k}번 책상을 가로지름`);
    }
  }
}

test('입장, 쉬는 길, 퇴근 경로가 모두 가로세로로만 이어지고 다른 책상을 지나지 않는다', () => {
  for (const [w, h] of SIZES) for (const count of [1, 5, 12]) {
    setup(w, h, count);
    const desks = run('L.desks');
    for (let i = 0; i < Math.min(count, desks); i++) {
      const label = `${w}x${h} count=${count} desk=${i}`;
      for (const status of ['busy', 'idle']) {
        const e = run(`({ desk: ${i}, data: { status: '${status}' } })`);
        ctx.__e = e;
        const head = run('entryPath(__e)'), tail = run('entryTail(__e)');
        check(`${label} 입장(${status})`, run('doorPos()'), head.concat(tail), i, count);
      }
      const d = run(`deskPos(${i})`);
      check(`${label} 쉬러 가기`, run(`seatPos(deskPos(${i}))`), run(`restRoute(deskPos(${i}))`), i, count);
      const out = (rest) => run(`exitRoute(deskPos(${i}), seatPos(deskPos(${i})), ${rest}, ${d.x + 68})`);
      check(`${label} 자리에서 퇴근`, run(`seatPos(deskPos(${i}))`), out(false), i, count);
      check(`${label} 리클라이너에서 퇴근`, run(`restPos(deskPos(${i}))`), out(true), i, count);
    }
  }
});

test('입장 도중 상태가 바뀌어도 어느 위치에서든 대각선이나 책상 통과 없이 새 목적지로 간다', () => {
  for (const [w, h] of [[1280, 860], [1900, 620]]) {
    setup(w, h, 6);
    for (let i = 0; i < 6; i++) {
      const d = run(`deskPos(${i})`);
      const lane = run(`laneY(deskPos(${i}))`), sx = run(`sideX(deskPos(${i}))`), s = run(`seatPos(deskPos(${i}))`);
      // 걷는 도중에 있을 수 있는 대표 위치: 옆길 입구, 옆길 중간, 자리 쪽 가로 구간, 리클라이너 쪽 세로 구간, 아래 통로 중간
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
        assert.ok(end.x === want.x && end.y === want.y, `${w}x${h} desk=${i}: 새 목적지에 도착하지 않음`);
        check(`${w}x${h} desk=${i} ${from}→${to} 위치(${p.x},${p.y})`, p, e.path, i, 6);
      }
    }
  }
});
