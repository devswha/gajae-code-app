import assert from 'node:assert/strict';
import test from 'node:test';

import { randomUUID } from './uuid';

test('falls back to an RFC 4122 v4 string when randomUUID is unavailable', () => {
  const insecureCrypto = {
    getRandomValues: (buffer: Uint8Array) => {
      buffer.fill(0xab);
      return buffer;
    },
  } as Crypto;
  assert.equal((insecureCrypto as { randomUUID?: unknown }).randomUUID, undefined);

  const uuid = randomUUID(insecureCrypto);
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // version and variant nibbles are forced regardless of the filled bytes
  assert.equal(uuid.slice(14, 15), '4');
  assert.ok(['8', '9', 'a', 'b'].includes(uuid.slice(19, 20)));
});

test('defers to the native randomUUID when the context is secure', () => {
  const secureCrypto = { randomUUID: () => 'native-uuid' } as unknown as Crypto;
  assert.equal(randomUUID(secureCrypto), 'native-uuid');
});

test('produces distinct ids across calls with the default source', () => {
  const first = randomUUID();
  const second = randomUUID();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});
