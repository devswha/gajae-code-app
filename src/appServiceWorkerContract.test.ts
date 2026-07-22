import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const serviceWorkerRegistrationPattern = /navigator\.serviceWorker\.register\(\s*['"]\/sw\.js/;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

test('Given the production shell when no service worker file ships then it does not register one', async () => {
  const rootDir = process.cwd();
  const indexHtml = await readFile(path.join(rootDir, 'index.html'), 'utf8');
  const serviceWorkerExists = await fileExists(path.join(rootDir, 'public', 'sw.js'));

  const registersMissingServiceWorker = serviceWorkerRegistrationPattern.test(indexHtml) && !serviceWorkerExists;

  assert.equal(registersMissingServiceWorker, false);
});
