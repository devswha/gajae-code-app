import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverLocalDevelopmentUrls } from './local-sites.js';

test('local development discovery suggests only open common ports and excludes the app server', async () => {
  const seen: number[] = [];
  const urls = await discoverLocalDevelopmentUrls(new Set([5173]), async (port) => {
    seen.push(port);
    return port === 3000 || port === 5173 || port === 8080;
  });

  assert.deepEqual(urls, ['http://localhost:3000', 'http://localhost:8080']);
  assert.equal(seen.includes(5173), false);
});
