import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

/*
 * The shipped worker exists only to receive web push. Offline caching was
 * removed on purpose: a cached shell served stale assets after updates and the
 * app is useless without its server anyway. These pin both halves so a worker
 * cannot quietly grow a fetch handler and the shell cannot register a worker
 * that is not shipped.
 */
const rootDir = process.cwd();

test('the shell registers the shipped push worker', async () => {
  const main = await readFile(path.join(rootDir, 'src', 'main.jsx'), 'utf8');
  assert.match(main, /navigator\.serviceWorker\.register\(SERVICE_WORKER_URL\)/);
  const hook = await readFile(path.join(rootDir, 'src', 'hooks', 'useWebPush.ts'), 'utf8');
  assert.match(hook, /export const SERVICE_WORKER_URL = '\/sw\.js'/);
  await readFile(path.join(rootDir, 'public', 'sw.js'), 'utf8');
});

test('the push worker handles push and taps only, never fetch', async () => {
  const worker = await readFile(path.join(rootDir, 'public', 'sw.js'), 'utf8');
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.doesNotMatch(worker, /addEventListener\('fetch'/);
  assert.doesNotMatch(worker, /caches\./);
});
