import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SessionStatusSummary from '../view/subcomponents/SessionStatusSummary';

/*
 * The composer footer's session summary.
 *
 * The rule worth testing is what it refuses to show. A percentage needs a real
 * context window behind it — the same 12.3K is comfortable in a 200k window and
 * nearly fatal in a 32k one, so inventing a default would print a confident
 * number that is wrong for the model actually answering.
 */

const render = (sessionState: Record<string, unknown> | null): string =>
  renderToStaticMarkup(createElement(SessionStatusSummary, { sessionState }));

const full = {
  modelId: 'openai/gpt-5-codex',
  thinkingLevel: 'high',
  cwd: '/Users/dev/repos/gajae-code-app',
  contextTokens: 42_000,
  contextWindow: 200_000,
  contextPercent: 21,
};

test('renders model, reasoning, directory and context share', () => {
  const html = render(full);

  assert.match(html, />gpt-5-codex</, 'the provider prefix is noise in a footer');
  assert.match(html, />high</);
  assert.match(html, /~\/repos\/gajae-code-app/, 'the home prefix should collapse to ~');
  assert.match(html, />21%</);
});

test('the full values stay reachable on hover', () => {
  const html = render(full);

  // The footer truncates; the untruncated value has to remain recoverable.
  assert.match(html, /title="openai\/gpt-5-codex"/);
  assert.match(html, /title="\/Users\/dev\/repos\/gajae-code-app"/);
  // Both figures, so the percentage can be checked against real numbers.
  assert.match(html, /title="42,000 \/ 200,000 tokens"/);
});

test('no percentage is shown without a real context window', () => {
  // This is the whole point. A token count with no denominator must not become
  // a percentage against an assumed window.
  const html = render({ modelId: 'gpt-5', contextTokens: 42_000, contextPercent: 21 });

  assert.match(html, />gpt-5</);
  assert.doesNotMatch(html, /%/);
});

test('each field appears only when the session reported it', () => {
  const modelOnly = render({ modelId: 'gpt-5' });
  assert.match(modelOnly, />gpt-5</);
  assert.doesNotMatch(modelOnly, /%/);

  const contextOnly = render({ contextPercent: 63, contextWindow: 128_000 });
  assert.match(contextOnly, />63%</);
  assert.doesNotMatch(contextOnly, />gpt-5</);
});

test('a default reasoning level is not worth a slot', () => {
  // Every session has one; printing "default" spends footer width on nothing.
  assert.doesNotMatch(render({ modelId: 'gpt-5', thinkingLevel: 'default' }), />default</);
  assert.match(render({ modelId: 'gpt-5', thinkingLevel: 'low' }), />low</);
});

test('deep paths collapse to their last segments', () => {
  const html = render({ cwd: '/var/opt/builds/team/project/service' });

  assert.match(html, /…\/project\/service/);
  assert.match(html, /title="\/var\/opt\/builds\/team\/project\/service"/);
});

test('nothing renders before the first turn reports anything', () => {
  assert.equal(render(null), '');
  assert.equal(render({}), '');
  // Malformed values are dropped rather than printed raw.
  assert.equal(render({ modelId: '  ', contextPercent: 'lots' }), '');
});
