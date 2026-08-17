import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FilesPanel from './FilesPanel';

const render = () => renderToStaticMarkup(createElement(FilesPanel, { onFileOpen: () => undefined }));

test('the files tab speaks through translations, never hardcoded prose', () => {
  const html = render();

  assert.doesNotMatch(html, /[\uAC00-\uD7A3]/, 'no Korean may be baked into the panel');
  assert.match(html, /workspace\.filesTab\.changeRoot/);
  assert.match(html, /workspace\.filesTab\.opening/);
});

test('the root is shown home-relative so the tab never claims a session path', () => {
  const html = render();

  assert.match(html, /~\/workspace/);
});

test('the panel opens on its loading state rather than an empty tree', () => {
  const html = render();

  assert.doesNotMatch(html, /workspace\.filesTab\.openFailed/);
  assert.match(html, /workspace\.filesTab\.opening/);
});
