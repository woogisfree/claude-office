// Frame pacing tests: node --test
// The pacer runs on a simulated clock with a 60 Hz display, so the frame rates can be checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/public/pacing.js'), 'utf8');
const { chooseFps, createPacer } = vm.runInContext(`${src}; ({ chooseFps, createPacer })`, vm.createContext({ Math }));

const VSYNC = 1000 / 60;
// A clock with a display that calls animation frame callbacks at every 1/60 second, and timers that fire at their exact time.
function world() {
  const w = { now: 0, events: [], draws: [], rafCalls: 0, hidden: false, nextId: 1 };
  const add = (at, fn) => { const ev = { at, fn, id: w.nextId++ }; w.events.push(ev); return ev.id; };
  w.raf = (cb) => { add((Math.floor(w.now / VSYNC) + 1) * VSYNC, () => { w.rafCalls++; cb(w.now); }); };
  w.setTimer = (fn, ms) => add(w.now + ms, fn);
  w.clearTimer = (id) => { w.events = w.events.filter((e) => e.id !== id); };
  w.runUntil = (t) => {
    for (;;) {
      w.events.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!w.events.length || w.events[0].at > t) break;
      const ev = w.events.shift(); w.now = ev.at; ev.fn();
    }
    w.now = t;
  };
  w.rate = (fromMs, toMs) => w.draws.filter((d) => d >= fromMs && d < toMs).length / ((toMs - fromMs) / 1000);
  return w;
}
const start = (w, fps) => {
  const state = { fps };
  const p = createPacer({ fps: () => state.fps, draw: (ms) => w.draws.push(ms), raf: w.raf, setTimer: w.setTimer, clearTimer: w.clearTimer, hidden: () => w.hidden });
  p.queue();
  return { p, state };
};

test('chooseFps: 30 while anything walks, shakes, or reacts, or the door moves', () => {
  const calm = { phase: 'rest', leaving: false, walking: false, path: [], surprise: 0, sulk: 0, hot: false, data: { status: 'idle' } };
  const base = { doorOpen: 0, lively: false };
  for (const change of [{ phase: 'enter' }, { leaving: true }, { walking: true }, { path: [{ x: 1, y: 1 }] }, { surprise: 1 }, { sulk: 1 }, { hot: true }]) {
    assert.equal(chooseFps({ ...base, employees: [calm, { ...calm, ...change }] }), 30, JSON.stringify(change));
  }
  assert.equal(chooseFps({ ...base, doorOpen: 0.1, employees: [calm] }), 30);
});

test('chooseFps: 15 for typing or a lively scene, 10 when everyone is still', () => {
  const idle = { phase: 'rest', leaving: false, walking: false, path: [], surprise: 0, sulk: 0, hot: false, data: { status: 'idle' } };
  const busy = { ...idle, phase: 'seated', data: { status: 'busy' } };
  assert.equal(chooseFps({ doorOpen: 0, lively: false, employees: [idle, idle] }), 10);
  assert.equal(chooseFps({ doorOpen: 0, lively: false, employees: [] }), 10);
  assert.equal(chooseFps({ doorOpen: 0, lively: false, employees: [idle, busy] }), 15);
  assert.equal(chooseFps({ doorOpen: 0, lively: true, employees: [idle] }), 15);
  assert.equal(chooseFps({ doorOpen: 0, lively: true, employees: [{ ...idle, walking: true }] }), 30);
});

test('createPacer: draws at the requested rate on a 60 Hz display', () => {
  for (const fps of [30, 15, 10]) {
    const w = world(); start(w, fps);
    w.runUntil(10000);
    const rate = w.rate(1000, 10000);
    assert.ok(Math.abs(rate - fps) <= 1, `${fps} fps requested, ${rate.toFixed(1)} drawn`);
  }
});

test('createPacer: a calm office is not woken at the display rate', () => {
  const w = world(); start(w, 10);
  w.runUntil(10000);
  // Without timers the loop would take a callback at every display refresh, 60 per second.
  assert.ok(w.rafCalls / 10 < 25, `${w.rafCalls / 10} animation frame callbacks per second`);
});

test('createPacer: a rate change takes effect within one frame of the old rate', () => {
  const w = world(); const { state } = start(w, 10);
  w.runUntil(3000);
  state.fps = 30;
  w.runUntil(3300);
  w.runUntil(6300);
  const rate = w.rate(3300, 6300);
  assert.ok(Math.abs(rate - 30) <= 1, `${rate.toFixed(1)} fps after the change`);
  state.fps = 10;
  w.runUntil(9600);
  const slow = w.rate(6600, 9600);
  assert.ok(Math.abs(slow - 10) <= 1, `${slow.toFixed(1)} fps after slowing down`);
});

test('createPacer: wake draws within one display refresh, even while waiting for a slow frame', () => {
  const w = world(); const { p } = start(w, 10);
  w.runUntil(2000);
  const before = w.draws.length;
  p.wake();
  w.runUntil(2000 + VSYNC + 1);
  assert.equal(w.draws.length, before + 1);
  assert.ok(w.draws[w.draws.length - 1] - 2000 <= VSYNC + 1);
});

test('createPacer: starting or waking the loop many times does not speed it up', () => {
  const w = world(); const { p } = start(w, 15);
  for (let i = 0; i < 5; i++) { p.queue(); p.wake(); }
  w.runUntil(10000);
  const rate = w.rate(1000, 10000);
  assert.ok(Math.abs(rate - 15) <= 1, `${rate.toFixed(1)} fps`);
});

test('createPacer: nothing is drawn while the page is hidden, and wake resumes it', () => {
  const w = world(); const { p } = start(w, 30);
  w.runUntil(1000);
  w.hidden = true;
  w.runUntil(1100); // the callback that is already queued finds the page hidden and stops the loop
  const drawn = w.draws.length;
  w.runUntil(5000);
  assert.equal(w.draws.length, drawn);
  w.hidden = false; p.wake();
  w.runUntil(6000);
  assert.ok(w.rate(5000, 6000) >= 29);
});
