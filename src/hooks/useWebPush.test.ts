import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applicationServerKey } from './useWebPush';

test('a base64url VAPID public key decodes to the 65 raw bytes PushManager expects', () => {
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  for (let index = 1; index < raw.length; index += 1) raw[index] = (index * 37 + 250) % 256;
  const base64url = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const decoded = applicationServerKey(base64url);

  assert.equal(decoded.length, 65);
  assert.deepEqual(Array.from(decoded), Array.from(raw));
  assert.ok(decoded.buffer instanceof ArrayBuffer);
});
