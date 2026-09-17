import assert from 'node:assert/strict';
import test from 'node:test';

import { isInlineProjectFileMimeType, projectFileResponseHeaders } from '@/shared/project-file-response.js';

/*
 * The file-content route serves bytes from the project the owner opened, on the
 * same origin as the app. Anything scriptable that renders there runs with the
 * app's cookie against the loopback API, so "inline" is an allowlist of the
 * images the chat itself displays, and nothing else.
 */

test('the images the chat renders stay inline with their own type', () => {
  for (const mimeType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    const headers = projectFileResponseHeaders(mimeType);
    assert.equal(headers['Content-Type'], mimeType);
    assert.equal(headers['Content-Disposition'], undefined);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  }
});

test('HTML and SVG are downloads, not same-origin documents', () => {
  for (const mimeType of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml']) {
    const headers = projectFileResponseHeaders(mimeType);
    assert.equal(isInlineProjectFileMimeType(mimeType), false, mimeType);
    assert.equal(headers['Content-Type'], 'application/octet-stream');
    assert.equal(headers['Content-Disposition'], 'attachment');
  }
});

test('an unknown type never becomes a sniffable document', () => {
  // mime.lookup returns false for an unknown extension.
  const headers = projectFileResponseHeaders(false);
  assert.equal(headers['Content-Type'], 'application/octet-stream');
  assert.equal(headers['Content-Disposition'], 'attachment');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});

test('every response carries nosniff and a sandbox policy', () => {
  for (const mimeType of ['image/png', 'text/html', 'text/plain', false as const]) {
    const headers = projectFileResponseHeaders(mimeType);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Content-Security-Policy'], "default-src 'none'; sandbox");
  }
});
