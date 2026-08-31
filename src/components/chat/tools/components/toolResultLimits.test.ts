import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';

import { ToolResultLimits, readToolResultLimits } from './ToolResultLimits';

/*
 * A tool that stops at a cap returns less than it found, and says so only in
 * the structured `meta.limits` the runtime attaches to its result. None of it
 * reaches the text the model sees, so before the details rail existed a
 * truncated search rendered as a complete one with nothing to contradict it.
 *
 * This reads that record defensively: it runs on every tool result, including
 * ones from other providers that never carry the shape at all.
 */

const withLimits = (limits: unknown) => ({ toolUseResult: { meta: { limits } } });

test('a match cap is reported with the count and the wider limit that would help', () => {
  const limits = readToolResultLimits(withLimits({ matchLimit: { reached: 50, suggestion: 200 } }));

  assert.deepEqual(limits?.matchLimit, { reached: 50, suggestion: 200 });
});

test('result and head caps are read the same way', () => {
  assert.deepEqual(
    readToolResultLimits(withLimits({ resultLimit: { reached: 20, suggestion: 100 } }))?.resultLimit,
    { reached: 20, suggestion: 100 },
  );
  assert.deepEqual(
    readToolResultLimits(withLimits({ headLimit: { reached: 10, suggestion: 50 } }))?.headLimit,
    { reached: 10, suggestion: 50 },
  );
});

test('a column truncation is reported even with no count cap', () => {
  const limits = readToolResultLimits(withLimits({ columnTruncated: { maxColumn: 200 } }));

  assert.deepEqual(limits?.columnTruncated, { maxColumn: 200 });
});

test('a result that hit no cap reports nothing', () => {
  // The row must stay absent rather than render an empty warning.
  assert.equal(readToolResultLimits({ toolUseResult: { meta: {} } }), undefined);
  assert.equal(readToolResultLimits({ toolUseResult: { meta: { limits: {} } } }), undefined);
  assert.equal(readToolResultLimits({ toolUseResult: {} }), undefined);
});

test('a result carrying no details at all reports nothing', () => {
  // Every other provider's results land here too, and none of them carry the
  // runtime's meta shape.
  assert.equal(readToolResultLimits({ content: 'plain', isError: false }), undefined);
  assert.equal(readToolResultLimits(undefined), undefined);
  assert.equal(readToolResultLimits(null), undefined);
  assert.equal(readToolResultLimits('a string'), undefined);
});

test('a malformed cap is ignored rather than rendered as a confident sentence', () => {
  // Zero reached means nothing was cut, and a non-numeric cap is not a cap.
  // Either would produce a sentence stating a number that means nothing.
  assert.equal(readToolResultLimits(withLimits({ matchLimit: { reached: 0, suggestion: 200 } })), undefined);
  assert.equal(readToolResultLimits(withLimits({ matchLimit: { reached: '50', suggestion: 200 } })), undefined);
  assert.equal(readToolResultLimits(withLimits({ matchLimit: { reached: 50 } })), undefined);
  assert.equal(readToolResultLimits(withLimits({ matchLimit: 'yes' })), undefined);
  assert.equal(readToolResultLimits(withLimits({ columnTruncated: { maxColumn: 0 } })), undefined);
});

/*
 * The copy has to come out of the namespace the component asks for.
 *
 * `tools.*` lives in the `chat` bundle and the app sets `defaultNS: 'common'`
 * with no `fallbackNS`, so a bare `useTranslation()` resolved nothing and the
 * row rendered the literal key `tools.limitReached` in every language. The
 * bundles are loaded from disk and i18next is initialized the way
 * `src/i18n/config.js` does, so this fails if either side moves.
 */

const bundle = (namespace: string) => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../../../i18n/locales/en/${namespace}.json`, import.meta.url)),
  'utf8',
));

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'settings', 'sidebar', 'chat', 'codeEditor'],
  defaultNS: 'common',
  keySeparator: '.',
  nsSeparator: ':',
  resources: { en: { common: bundle('common'), chat: bundle('chat') } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const render = (limits: unknown) =>
  renderToStaticMarkup(createElement(ToolResultLimits, { toolResult: withLimits(limits) }));

test('a cap notice renders its translated sentence, not the raw key', () => {
  const html = render({ matchLimit: { reached: 50, suggestion: 200 } });

  assert.doesNotMatch(html, /tools\.limitReached/);
  assert.match(html, /Stopped at 50 results; a limit of 200 would return more\./);
});

test('a column truncation renders its translated sentence too', () => {
  const html = render({ columnTruncated: { maxColumn: 200 } });

  assert.doesNotMatch(html, /tools\.columnTruncated/);
  assert.match(html, /Long lines were cut at column 200\./);
});

test('a result that hit no cap renders nothing at all', () => {
  assert.equal(render({}), '');
});

test('a hostile details shape never throws', () => {
  for (const shape of [
    { toolUseResult: 'string' },
    { toolUseResult: { meta: 'string' } },
    { toolUseResult: { meta: { limits: 42 } } },
    { toolUseResult: { meta: { limits: null } } },
  ]) {
    assert.doesNotThrow(() => readToolResultLimits(shape));
    assert.equal(readToolResultLimits(shape), undefined);
  }
});
