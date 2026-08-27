import assert from 'node:assert/strict';
import test from 'node:test';

import { isBrowserHref } from './Markdown.js';

test('only absolute HTTP links are routed to the session Browser panel', () => {
  assert.equal(isBrowserHref('http://100.78.133.28:8080'), true);
  assert.equal(isBrowserHref('https://example.com/path'), true);
  assert.equal(isBrowserHref('mailto:test@example.com'), false);
  assert.equal(isBrowserHref('/workspace/file.ts'), false);
  assert.equal(isBrowserHref('#section'), false);
});
