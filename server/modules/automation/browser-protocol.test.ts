import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_PROTOCOL_VERSION,
  BrowserNdjsonDecoder,
  safeSessionId,
  serializeBrowserFrame,
  type BrowserRequestFrame,
} from './browser-protocol.js';

test('browser protocol decodes split and coalesced NDJSON frames', () => {
  const frame: BrowserRequestFrame = {
    protocolVersion: BROWSER_PROTOCOL_VERSION,
    kind: 'request',
    id: 'request-1',
    method: 'status',
    payload: {},
  };
  const decoder = new BrowserNdjsonDecoder();
  const serialized = serializeBrowserFrame(frame);

  assert.deepEqual(decoder.push(serialized.slice(0, 7)), []);
  assert.deepEqual(decoder.push(`${serialized.slice(7)}${serialized}`), [frame, frame]);
});
test('browser session identifiers reject traversal and control characters', () => {
  assert.equal(safeSessionId('session-1:browser'), true);
  assert.equal(safeSessionId('../session'), false);
  assert.equal(safeSessionId('session\n2'), false);
  assert.equal(safeSessionId(''), false);
});

test('browser decoder rejects a non-protocol JSON object', () => {
  const decoder = new BrowserNdjsonDecoder();
  assert.throws(() => decoder.push('{"kind":"request"}\n'), /Invalid browser protocol frame/);
});
