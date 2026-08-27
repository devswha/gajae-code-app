import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import QueuedMessageCard from './QueuedMessageCard';

type Props = Parameters<typeof QueuedMessageCard>[0];

const render = (overrides: Partial<Props> = {}): string => renderToStaticMarkup(createElement(QueuedMessageCard, {
  content: 'run the migration',
  position: 1,
  total: 1,
  onEdit: () => undefined,
  onDelete: () => undefined,
  ...overrides,
}));

test('a lone queued message says it goes out when the turn finishes', () => {
  const html = render();

  assert.match(html, /run the migration/);
  assert.match(html, /input\.queue\.willSend/);
  assert.doesNotMatch(html, /input\.queue\.willFollow/);
});

test('a single message shows no reorder controls, because there is nothing to reorder', () => {
  const html = render();

  assert.doesNotMatch(html, /input\.queue\.moveUp/);
  assert.doesNotMatch(html, /input\.queue\.moveDown/);
});

test('messages behind the head say they follow, not that they send next', () => {
  const html = render({ position: 2, total: 3, onMoveUp: () => undefined, onMoveDown: () => undefined });

  assert.match(html, /input\.queue\.willFollow/);
  assert.doesNotMatch(html, /input\.queue\.willSend/);
});

test('position is shown once the queue holds more than one message', () => {
  const html = render({ position: 2, total: 3 });

  assert.match(html, />2</);
});

test('the ends of the queue disable the move that would do nothing', () => {
  const head = render({ position: 1, total: 2, onMoveDown: () => undefined });
  // The className carries `disabled:` variants, so the attribute has to be read
  // off the button's own tag rather than matched anywhere in the markup.
  const buttonFor = (label: string) => head
    .split('<button')
    .find((fragment) => fragment.includes(`aria-label="${label}"`)) ?? '';

  assert.match(buttonFor('input.queue.moveUp'), /disabled=""/);
  assert.doesNotMatch(buttonFor('input.queue.moveDown'), /disabled=""/);
});

test('attached images are reported through a counted translation', () => {
  const html = render({ imageCount: 2 });

  assert.match(html, /input\.queue\.images/);
});

test('edit and delete stay available for every queued message', () => {
  const html = render({ position: 3, total: 3 });

  assert.match(html, /aria-label="input\.queue\.edit"/);
  assert.match(html, /aria-label="input\.queue\.delete"/);
});
