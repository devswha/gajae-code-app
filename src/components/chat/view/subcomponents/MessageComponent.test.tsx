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
