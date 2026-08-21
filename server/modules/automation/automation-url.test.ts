import assert from 'node:assert/strict';
import test from 'node:test';

import { automationOrigin, normalizeAutomationUrl } from './automation-url.js';

test('automation URLs normalize host shorthand and preserve safe web URLs', () => {
  assert.equal(normalizeAutomationUrl('localhost:5173'), 'http://localhost:5173/');
  assert.equal(normalizeAutomationUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
  assert.equal(automationOrigin('https://example.com/docs'), 'https://example.com');
  assert.equal(automationOrigin('about:blank'), null);
});

test('automation URLs reject non-web schemes', () => {
  assert.throws(() => normalizeAutomationUrl('file:///tmp/private'), /Only HTTP and HTTPS/);
  assert.throws(() => normalizeAutomationUrl('javascript:alert(1)'), /Only HTTP and HTTPS/);
});
