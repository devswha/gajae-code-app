import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SyntaxHighlighter from './syntaxHighlighter';

/*
 * The PrismLight build highlights only registered languages; a missing
 * registration silently renders plain text. These assertions pin the
 * registrations (including fence aliases) that replaced the full ~620 KB
 * Prism bundle, so a refactor that drops one degrades loudly here instead of
 * silently in the chat.
 */

const render = (language: string, code: string) =>
  renderToStaticMarkup(createElement(SyntaxHighlighter, { language }, code));

test('registered languages produce token markup', () => {
  const html = render('typescript', 'const x: number = 1;');
  assert.match(html, /token/, 'typescript must be highlighted, not plain text');
});

test('common fence aliases resolve to their languages', () => {
  for (const [alias, code] of [
    ['ts', 'const x: number = 1;'],
    ['js', 'const x = 1;'],
    ['sh', 'echo hi'],
    ['py', 'def f(): pass'],
    ['yml', 'key: value'],
    ['html', '<div>hi</div>'],
  ] as const) {
    assert.match(render(alias, code), /token/, `alias '${alias}' must highlight`);
  }
});

test('an unregistered language degrades to an unhighlighted block', () => {
  const html = render('cobol', 'MOVE A TO B.');
  assert.doesNotMatch(html, /class="token /, 'unknown fences stay plain');
  assert.match(html, /MOVE A TO B\./, 'the code itself still renders');
});
