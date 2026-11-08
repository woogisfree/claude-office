// Auto clock-out tests: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/public/autoleave.js'), 'utf8');
const { splitGone } = vm.runInContext(`${src}; ({ splitGone })`, vm.createContext({}));

const H = 3600e3, NOW = 1_000_000 * H;
const ses = (id, status, hoursAgo, extra = {}) => ({ sessionId: id, status, statusUpdatedAt: NOW - hoursAgo * H, ...extra });
const ids = (l) => Array.from(l, (s) => s.sessionId); // arrays made inside the vm have another prototype, so copy them

test('splitGone: a session that rested long enough goes home, the others stay', () => {
  const list = [ses('old', 'idle', 5), ses('fresh', 'idle', 1), ses('busy', 'busy', 9)];
  const r = splitGone(list, 4, NOW);
  assert.deepEqual(ids(r.gone), ['old']);
  assert.deepEqual(ids(r.present), ['fresh', 'busy']);
});

test('splitGone: the limit itself counts, and turning it off keeps everyone', () => {
  const list = [ses('edge', 'idle', 4)];
  assert.deepEqual(ids(splitGone(list, 4, NOW).gone), ['edge']);
  assert.deepEqual(ids(splitGone(list, 0, NOW).gone), []);
  assert.deepEqual(ids(splitGone(list, 0, NOW).present), ['edge']);
});

test('splitGone: a session waiting for approval never goes home', () => {
  const r = splitGone([ses('w', 'waiting', 30)], 2, NOW);
  assert.deepEqual(ids(r.gone), []);
});

test('splitGone: a session without a status time stays', () => {
  const r = splitGone([{ sessionId: 'x', status: 'idle' }], 2, NOW);
  assert.deepEqual(ids(r.gone), []);
});

test('splitGone: a session comes back when it works again', () => {
  const asleep = [ses('a', 'idle', 6)];
  assert.deepEqual(ids(splitGone(asleep, 4, NOW).gone), ['a']);
  const awake = [ses('a', 'busy', 0)];
  assert.deepEqual(ids(splitGone(awake, 4, NOW).present), ['a']);
});

test('splitGone: children leave with their parent and are not listed on their own', () => {
  const list = [ses('p', 'idle', 6), ses('c1', 'idle', 6, { parentId: 'p', kind: 'subagent' }), ses('q', 'busy', 0)];
  const r = splitGone(list, 4, NOW);
  assert.deepEqual(ids(r.gone), ['p']);
  assert.deepEqual(ids(r.present), ['q']);
});

test('splitGone: a parent with a working subagent or teammate stays', () => {
  const list = [ses('p', 'idle', 6), ses('c', 'busy', 0, { parentId: 'p', kind: 'teammate' })];
  const r = splitGone(list, 4, NOW);
  assert.deepEqual(ids(r.gone), []);
  assert.deepEqual(ids(r.present), ['p', 'c']);
});
