import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { isBrowserHref, Markdown } from './Markdown.js';

test('only absolute HTTP links are handed to the external browser', () => {
  assert.equal(isBrowserHref('http://100.78.133.28:8080'), true);
  assert.equal(isBrowserHref('https://example.com/path'), true);
  assert.equal(isBrowserHref('mailto:test@example.com'), false);
  assert.equal(isBrowserHref('/workspace/file.ts'), false);
  assert.equal(isBrowserHref('#section'), false);
});

test('server-rendered HTTP(S) Markdown links stay ordinary external links', () => {
  const html = renderToStaticMarkup(createElement(Markdown, null, '[local](http://localhost:5173/path) [docs](https://example.com/docs)'));
  assert.match(html, /href="http:\/\/localhost:5173\/path"/);
  assert.match(html, /href="https:\/\/example\.com\/docs"/);
  assert.doesNotMatch(html, /builtin-browser/);
});
