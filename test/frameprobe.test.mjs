// Frame probe tests: node --test
// The recorder must give the same signature for the same drawing and a different one for any difference that changes the picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/public/frameprobe.js'), 'utf8');
const { createRecorder } = vm.runInContext(`${src}; ({ createRecorder })`, vm.createContext({ Math, String, WeakMap, Proxy, Error }));
const sign = (fn) => { const r = createRecorder(); fn(r); return r.signature(); };
const img = {}, other = {};

test('the same drawing gives the same signature, however many recorders it goes through', () => {
  const draw = (g) => { g.fillStyle = '#fff'; g.fillRect(1, 2, 3, 4); g.drawImage(img, 5, 6); g.save(); g.globalAlpha = 0.5; g.restore(); };
  assert.equal(sign(draw), sign(draw));
});

test('any difference in a call, an argument, or the order changes the signature', () => {
  const base = sign((g) => { g.fillStyle = '#fff'; g.fillRect(1, 2, 3, 4); });
  assert.notEqual(base, sign((g) => { g.fillStyle = '#fff'; g.fillRect(1, 2, 3, 5); }));
  assert.notEqual(base, sign((g) => { g.fillStyle = '#fef'; g.fillRect(1, 2, 3, 4); }));
  assert.notEqual(base, sign((g) => { g.fillRect(1, 2, 3, 4); g.fillStyle = '#fff'; }));
  assert.notEqual(base, sign((g) => { g.fillStyle = '#fff'; g.fillRect(1, 2, 3, 4); g.fillRect(1, 2, 3, 4); }));
  assert.notEqual(sign((g) => g.fillRect(1, 23, 4, 5)), sign((g) => g.fillRect(12, 3, 4, 5)), 'neighbouring numbers must not run together');
  assert.notEqual(sign((g) => g.fillRect(1, 2, 3, 4)), sign((g) => g.rect(1, 2, 3, 4)));
});

test('images are told apart by identity, and a transform or a clip changes the signature', () => {
  assert.notEqual(sign((g) => g.drawImage(img, 0, 0)), sign((g) => g.drawImage(other, 0, 0)));
  assert.equal(sign((g) => g.drawImage(img, 0, 0)), sign((g) => g.drawImage(img, 0, 0)));
  // The order in which the images first appear must not matter: the same image keeps its number from frame to frame.
  assert.notEqual(sign((g) => { g.drawImage(img, 0, 0); g.drawImage(other, 0, 0); }), sign((g) => { g.drawImage(other, 0, 0); g.drawImage(img, 0, 0); }));
  assert.notEqual(sign((g) => { g.save(); g.translate(2, 0); g.scale(-1, 1); g.restore(); }), sign((g) => { g.save(); g.translate(3, 0); g.scale(-1, 1); g.restore(); }));
  assert.notEqual(sign((g) => { g.beginPath(); g.rect(0, 0, 5, 5); g.clip(); }), sign((g) => { g.beginPath(); g.rect(0, 0, 5, 6); g.clip(); }));
  assert.notEqual(sign((g) => { g.globalAlpha = 1; }), sign((g) => { g.globalAlpha = 0.5; }));
  assert.notEqual(sign((g) => { g.imageSmoothingEnabled = false; }), sign((g) => { g.imageSmoothingEnabled = true; }));
});

test('note() puts a hidden change into the signature, and probe marks the recorder', () => {
  assert.notEqual(sign((g) => g.note('night', 0.3)), sign((g) => g.note('night', 0.4)));
  assert.equal(createRecorder().probe, true);
});

test('a call or a property the recorder does not know throws, so the caller can fall back to drawing', () => {
  const g = createRecorder();
  assert.throws(() => g.strokeRect(0, 0, 1, 1), /unknown member/);
  assert.throws(() => { g.lineWidth = 2; }, /unknown property/);
  assert.throws(() => g.createLinearGradient(0, 0, 1, 1), /unknown member/);
});
