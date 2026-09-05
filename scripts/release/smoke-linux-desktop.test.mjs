import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Linux GUI smoke rejects false render passes, leaked environments and incomplete shutdown', { skip: process.platform !== 'linux' }, () => {
  const script = fileURLToPath(new URL('./smoke-linux-desktop.py', import.meta.url));
  const result = spawnSync('python3', [script, '--self-test'], { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
