import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../../../../i18n/config';
import type { ChatMessage } from '../../types/types';

import MessageComponent from './MessageComponent';

const renderMessage = (message: ChatMessage): string => renderToStaticMarkup(createElement(MessageComponent, {
  message,
  prevMessage: null,
  createDiff: () => [],
  provider: 'gjc',
}));

test('image preview preference omits attachment markup when disabled', () => {
  const message: ChatMessage = {
    type: 'user',
    content: 'inspect this',
    timestamp: '2026-08-13T00:00:00.000Z',
    images: [{ data: 'data:image/png;base64,aGVsbG8=', name: 'sample.png' }],
  };
  const props = {
    message,
    prevMessage: null,
    createDiff: () => [],
    provider: 'gjc',
  };

  assert.match(renderToStaticMarkup(createElement(MessageComponent, props)), /sample\.png/);
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(MessageComponent, { ...props, showImagePreviews: false })),
    /sample\.png|data:image\/png/,
  );
});

test('truncated tool history offers an explicit full-output load action', () => {
  const html = renderMessage({
    sessionId: 'session-1',
    type: 'assistant',
    content: '',
    timestamp: '2026-08-13T00:00:00.000Z',
    isToolUse: true,
    toolName: 'Bash',
    toolInput: JSON.stringify({ command: 'diagnostic' }),
    toolId: 'tool-large',
    toolResult: { content: 'bounded preview', isError: false },
    toolResultTruncated: true,
    toolResultBytes: 2 * 1024 * 1024,
  });

  assert.match(html, /Load full output/);
  assert.match(html, /2048 KB/);
});

test('a user turn is its bubble alone, with no avatar badge beside it', () => {
  const html = renderMessage({
    type: 'user',
    content: 'ship it',
    timestamp: new Date('2026-08-18T07:00:00Z'),
  });

  assert.match(html, /ship it/);
  // The right-hand column of blue bubbles already says who is speaking.
  assert.doesNotMatch(html, />\s*U\s*</);
  assert.doesNotMatch(html, /h-8 w-8[^"]*rounded-full[^"]*bg-blue-600/);
});

test('a tool call is a row, not a card', () => {
  const html = renderMessage({
    type: 'tool',
    toolName: 'Bash',
    toolInput: { command: 'npm test' },
    timestamp: new Date('2026-08-18T07:00:00Z'),
  } as never);

  // The rail and the filled block were the whole weight of a tool call.
  assert.doesNotMatch(html, /border-l-2/);
  assert.doesNotMatch(html, /rounded-r-md/);
});

test('a turn ends with a visible, quiet footer rather than nothing at all', () => {
  const html = renderMessage({
    type: 'assistant',
    content: 'done',
    timestamp: new Date('2026-08-18T07:00:00Z'),
  });

  // Hiding this outright removed the only mark for where an answer ends.
  assert.doesNotMatch(html, /opacity-0/);
  assert.match(html, /text-muted-foreground\/50/);
  assert.match(html, /aria-label="Copy message"/);
});

test('a new exchange is separated from the one before it', () => {
  const user = { type: 'user' as const, content: 'next question', timestamp: '2026-08-18T07:00:00.000Z' };

  const first = renderToStaticMarkup(createElement(MessageComponent, {
    message: user,
    prevMessage: null,
    createDiff: () => [],
    provider: 'gjc',
  }));
  const later = renderToStaticMarkup(createElement(MessageComponent, {
    message: user,
    prevMessage: { type: 'assistant', content: 'previous answer', timestamp: '2026-08-18T06:59:00.000Z' },
    createDiff: () => [],
    provider: 'gjc',
  }));

  assert.doesNotMatch(first, /border-t/);
  assert.match(later, /border-t/);
});

test('a live gjc turn carries no name row, while a stored foreign transcript keeps one', () => {
  const turn: ChatMessage = {
    type: 'assistant',
    content: 'done',
    timestamp: '2026-08-18T07:00:00.000Z',
  };

  const gjc = renderToStaticMarkup(createElement(MessageComponent, {
    message: turn,
    prevMessage: null,
    createDiff: () => [],
    provider: 'gjc',
  }));
  const claude = renderToStaticMarkup(createElement(MessageComponent, {
    message: turn,
    prevMessage: null,
    createDiff: () => [],
    provider: 'claude',
  }));

  // The copy control keeps its own label, so this asks specifically about the
  // provider badge.
  assert.doesNotMatch(gjc, /aria-label="(Claude|Codex|OpenCode|Cursor|gjc)"/);
  assert.match(claude, /aria-label="Claude"/);
});
