// Server lifecycle test: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/server.mjs');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the server exits on its own after its parent process dies', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-life-'));
  // The shell starts the server in the background, prints its pid, waits for the server to record its parent, then exits, which orphans the server.
  const env = { ...process.env, CLAUDE_OFFICE_CLAUDE_DIR: tmp, CLAUDE_OFFICE_SUN: '06:00,19:00', CLAUDE_OFFICE_EXIT_WITH_PARENT: '1', PORT: '0' };
  const r = spawnSync('sh', ['-c', `"${process.execPath}" "${server}" >/dev/null 2>&1 & echo $!; sleep 1.5`], { env, encoding: 'utf8' });
  const pid = Number(r.stdout.trim());
  assert.ok(pid > 0, 'could not read the server pid');
  try {
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) { await sleep(250); gone = !alive(pid); }
    assert.ok(gone, 'the orphaned server is still running');
  } finally {
    if (alive(pid)) process.kill(pid);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('without the flag, the server keeps running after its parent exits', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-life-'));
  const env = { ...process.env, CLAUDE_OFFICE_CLAUDE_DIR: tmp, CLAUDE_OFFICE_SUN: '06:00,19:00', PORT: '0' };
  delete env.CLAUDE_OFFICE_EXIT_WITH_PARENT;
  const r = spawnSync('sh', ['-c', `"${process.execPath}" "${server}" >/dev/null 2>&1 & echo $!; sleep 1.5`], { env, encoding: 'utf8' });
  const pid = Number(r.stdout.trim());
  try {
    await sleep(3500);
    assert.ok(alive(pid), 'the server should still be running');
  } finally {
    if (alive(pid)) process.kill(pid);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
