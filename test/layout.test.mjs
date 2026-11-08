// 화면 배치 계산 테스트: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/public/layout.js'), 'utf8');
const stage = { clientWidth: 1200, clientHeight: 800 };
const el = (extra = {}) => ({ getContext: () => ({}), ...extra });
const ctx = vm.createContext({
  document: { querySelector: (sel) => (sel === '#stage' ? stage : el()) },
  location: { search: '' }, URLSearchParams, window: {}, Math, Number, Array, Set, Map,
});
vm.runInContext(src, ctx);
const layout = (w, h, count, zoom) => {
  stage.clientWidth = w; stage.clientHeight = h;
  vm.runInContext(`baseZoom = ${zoom || 3}; computeLayout(${count}); ({ ...L, cells: Array.from({ length: L.desks }, (_, i) => deskPos(i)), CELL_W, CELL_H, GUTTER })`, ctx);
  return vm.runInContext(`({ ...L, cells: Array.from({ length: L.desks }, (_, i) => deskPos(i)), CELL_W, CELL_H, GUTTER })`, ctx);
};

const SIZES = [[900, 600], [1100, 760], [1280, 860], [1728, 1000], [1900, 620], [1900, 420], [2400, 1200]];

test('책상 칸이 서로 겹치지 않고 방 안에 들어온다', () => {
  for (const [w, h] of SIZES) for (const count of [0, 1, 5, 12]) {
    const l = layout(w, h, count);
    for (const c of l.cells) {
      const x0 = c.x - l.GUTTER, x1 = x0 + l.CELL_W;
      assert.ok(x0 >= 0 && x1 <= l.W + 1, `${w}x${h} count=${count}: 가로로 방 밖 x0=${x0} x1=${x1} W=${l.W}`);
    }
    const byRow = new Map();
    for (const c of l.cells) { byRow.set(c.row, [...(byRow.get(c.row) || []), c]); }
    for (const cells of byRow.values()) {
      cells.sort((a, b) => a.x - b.x);
      for (let i = 1; i < cells.length; i++) assert.ok(cells[i].x - cells[i - 1].x >= l.CELL_W - 1, `${w}x${h} count=${count}: 같은 줄에서 칸이 겹침`);
    }
  }
});

test('세션이 창에 들어가면 스크롤이 필요 없다', () => {
  for (const [w, h] of SIZES) {
    const l = layout(w, h, 5);
    assert.ok(l.H <= Math.floor(h / l.zoom) + 1, `${w}x${h}: 세션 5개인데 높이가 넘침 (H=${l.H}, 보이는 높이=${Math.floor(h / l.zoom)})`);
  }
});

test('낮고 넓은 창에서는 한 줄만 그리고 잘리지 않는다', () => {
  const l = layout(1900, 620, 5);
  assert.equal(l.rows, 1);
  assert.ok(l.H <= Math.floor(620 / l.zoom) + 1);
});

test('세션이 많아 높이에 안 들어가면 배율을 줄이고, 그래도 넘치면 스크롤한다', () => {
  const small = layout(1100, 500, 12);
  assert.equal(small.zoom, 2);
  const huge = layout(1100, 500, 80);
  assert.equal(huge.zoom, 2);
  assert.ok(huge.H > Math.floor(500 / huge.zoom), '80개는 스크롤이 필요해야 한다');
});

test('세로 통로와 문이 방 안에 있고 책상 수가 세션 수보다 적지 않다', () => {
  for (const [w, h] of SIZES) for (const count of [0, 3, 9, 25]) {
    const l = layout(w, h, count);
    assert.ok(l.aisleX > 0 && l.aisleX < l.W, `${w}x${h}: 통로 위치`);
    assert.ok(l.doorX > 0 && l.doorX < l.W, `${w}x${h}: 문 위치`);
    assert.ok(l.desks >= count, `${w}x${h} count=${count}: 책상이 모자람 (${l.desks})`);
  }
});

test('같은 입력이면 같은 배치가 나온다', () => {
  assert.deepEqual(layout(1280, 860, 6), layout(1280, 860, 6));
});

test('cityClock: 선택한 도시의 현지 시각을 UTC 오프셋으로 계산한다', () => {
  const at = Date.UTC(2026, 10, 8, 3, 30, 0); // 2026-11-08 03:30 UTC
  const clock = (off) => vm.runInContext(`cityClock(${at}, ${off})`, ctx);
  assert.equal(clock(9 * 3600).hour, 12.5); // 서울, 도쿄
  assert.equal(clock(9 * 3600).h, 12);
  assert.equal(clock(-5 * 3600).h, 22); // 뉴욕: 전날 22:30
  assert.equal(clock(-5 * 3600).m, 30);
  assert.equal(clock(0).hour, 3.5); // 런던
  assert.equal(clock(19800).hour, 9); // 인도(+5:30)처럼 30분 단위 오프셋
  const local = vm.runInContext(`cityClock(${at}, null)`, ctx);
  assert.equal(local.h, new Date(at).getHours()); // 오프셋이 없으면 이 컴퓨터의 시각
});
