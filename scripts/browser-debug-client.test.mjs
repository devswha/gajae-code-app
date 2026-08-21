import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { runBrowserDebugClient } from './browser-debug-client.mjs';

test('browser debug client calls the long-running server instead of launching Chromium', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ accepted: true }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Debug client test server did not bind.');
  const output = [];
  try {
    await runBrowserDebugClient([
      '--base-url', `http://127.0.0.1:${address.port}`,
      '--session', 'debug-1',
      '--cookie', 'secret',
      'command', '{"action":"observe"}',
    ], (value) => output.push(value));
  } finally {
    server.close();
    await once(server, 'close');
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/api/browser/debug-1/command');
  assert.equal(requests[0].headers.cookie, 'gajae_desktop_api_key=secret');
  assert.deepEqual(JSON.parse(requests[0].body), { command: { action: 'observe' } });
  assert.deepEqual(output.map(JSON.parse), [{ accepted: true }]);
});
