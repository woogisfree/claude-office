// Layout calculation tests: node --test
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

test('desk cells do not overlap and stay inside the room', () => {
  for (const [w, h] of SIZES) for (const count of [0, 1, 5, 12]) {
    const l = layout(w, h, count);
    for (const c of l.cells) {
      const x0 = c.x - l.GUTTER, x1 = x0 + l.CELL_W;
      assert.ok(x0 >= 0 && x1 <= l.W + 1, `${w}x${h} count=${count}: outside the room horizontally x0=${x0} x1=${x1} W=${l.W}`);
    }
    const byRow = new Map();
    for (const c of l.cells) { byRow.set(c.row, [...(byRow.get(c.row) || []), c]); }
    for (const cells of byRow.values()) {
      cells.sort((a, b) => a.x - b.x);
      for (let i = 1; i < cells.length; i++) assert.ok(cells[i].x - cells[i - 1].x >= l.CELL_W - 1, `${w}x${h} count=${count}: cells overlap in the same row`);
    }
  }
});

test('no scrolling is needed when the sessions fit the window', () => {
  for (const [w, h] of SIZES) {
    const l = layout(w, h, 5);
    assert.ok(l.H <= Math.floor(h / l.zoom) + 1, `${w}x${h}: 5 sessions but the height overflows (H=${l.H}, visible height=${Math.floor(h / l.zoom)})`);
  }
});

test('a short, wide window draws a single row without clipping', () => {
  const l = layout(1900, 620, 5);
  assert.equal(l.rows, 1);
  assert.ok(l.H <= Math.floor(620 / l.zoom) + 1);
});

test('when many sessions do not fit, lower the zoom, and scroll if it still overflows', () => {
  const small = layout(1100, 500, 12);
  assert.equal(small.zoom, 2);
  const huge = layout(1100, 500, 80);
  assert.equal(huge.zoom, 2);
  assert.ok(huge.H > Math.floor(500 / huge.zoom), '80 sessions should need scrolling');
});

test('the aisle and door are inside the room and there are at least as many desks as sessions', () => {
  for (const [w, h] of SIZES) for (const count of [0, 3, 9, 25]) {
    const l = layout(w, h, count);
    assert.ok(l.aisleX > 0 && l.aisleX < l.W, `${w}x${h}: aisle position`);
    assert.ok(l.doorX > 0 && l.doorX < l.W, `${w}x${h}: door position`);
    assert.ok(l.desks >= count, `${w}x${h} count=${count}: not enough desks (${l.desks})`);
  }
});

test('the same input gives the same layout', () => {
  assert.deepEqual(layout(1280, 860, 6), layout(1280, 860, 6));
});

test('cityClock: computes the local time of the selected city from the UTC offset', () => {
  const at = Date.UTC(2026, 10, 8, 3, 30, 0); // 2026-11-08 03:30 UTC
  const clock = (off) => vm.runInContext(`cityClock(${at}, ${off})`, ctx);
  assert.equal(clock(9 * 3600).hour, 12.5); // Seoul, Tokyo
  assert.equal(clock(9 * 3600).h, 12);
  assert.equal(clock(-5 * 3600).h, 22); // New York: 22:30 the previous day
  assert.equal(clock(-5 * 3600).m, 30);
  assert.equal(clock(0).hour, 3.5); // London
  assert.equal(clock(19800).hour, 9); // an offset in 30-minute steps, like India (+5:30)
  const local = vm.runInContext(`cityClock(${at}, null)`, ctx);
  assert.equal(local.h, new Date(at).getHours()); // without an offset, this computer's time
});
