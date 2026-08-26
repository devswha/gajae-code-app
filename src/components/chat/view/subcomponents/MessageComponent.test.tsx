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
  // The right-hand column of accent bubbles already says who is speaking.
  assert.doesNotMatch(html, />\s*U\s*</);
  assert.doesNotMatch(html, /h-8 w-8[^"]*rounded-full[^"]*bg-primary/);
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

test('message text uses one typeface and a readable measure', () => {
  const html = renderMessage({
    type: 'assistant',
    content: 'Paseo와 가재앱을 비교한다',
    timestamp: new Date('2026-08-18T07:00:00Z'),
  });

  // The serif stack carries no Hangul, so a mixed sentence rendered two faces.
  assert.doesNotMatch(html, /font-serif/);
  // No reading measure on prose. A cap protects the return sweep between
  // lines, and it went through 68ch and 90ch before being removed outright:
  // the asymmetry it created - tables, code and tool output reaching the
  // column edge while sentences stopped short of it - was reported as wrong
  // repeatedly, and the person reading these transcripts all day chose the
  // fuller column over the shorter line. Line length is now bounded only by
  // the column, which still caps at 66rem.
  assert.doesNotMatch(html, /max-w-\[\d+ch\]/);
  assert.match(html, /mb-2 last:mb-0/);
  // Body text is 16px, not the 14px prose-sm the tool renderers use, which is
  // also where ChatGPT and Claude sit. Denser output is the point in a tool
  // renderer; a message body is read, not scanned.
  assert.match(html, /prose prose-base/);
  assert.doesNotMatch(html, /prose prose-sm/);
  // A wrapped command is worse than a long one, so code keeps the full width -
  // which requires the container itself to stay uncapped.
  assert.match(html, /max-w-none/);
  // Static markup escapes the & in the arbitrary-variant class name.
  assert.match(html, /\[&(amp;)?_pre\]:max-w-none/);
});

test('the user bubble carries its own shade rather than the button accent', () => {
  const html = renderMessage({
    type: 'user',
    content: 'contrast check',
    timestamp: new Date('2026-08-18T07:00:00Z'),
  });

  // The accent that reads well as a small button only reaches 3.5:1 behind
  // body text, and filling a whole bubble with it forced a choice between
  // dark text on vivid orange or light text below AA. The bubble owns a
  // darker shade so its light text clears AA without dulling every button.
  assert.match(html, /bg-chat-bubble/);
  assert.match(html, /text-chat-bubble-foreground/);
  assert.doesNotMatch(html, /rounded-2xl[^"]*bg-primary\b/);
});

test('a user bubble is the size of what was typed', () => {
  const html = renderMessage({
    type: 'user',
    content: 'ok',
    timestamp: new Date('2026-08-18T07:00:00Z'),
  });

  // Hidden with opacity alone, the controls row still held a 20px line inside
  // bubble, so a two-character message rendered a three-line bubble.
  assert.match(html, /absolute right-1 top-full/);
  assert.doesNotMatch(html, /mt-1 flex items-center justify-end gap-1 text-xs text-primary-foreground\/80/);
});

test('local command stdout renders as escaped preformatted text instead of Markdown math', () => {
  const html = renderMessage({
    type: 'assistant',
    content: '$CacheHitRate: 0.5\n中🙂 `code` <tag>',
    timestamp: '2026-08-13T00:00:00.000Z',
    isLocalCommandStdout: true,
  });

  assert.match(html, /<pre[^>]*><code>/);
  assert.match(html, /\$CacheHitRate: 0\.5/);
  assert.match(html, /中🙂 `code` &lt;tag&gt;/);
  assert.doesNotMatch(html, /class="katex|<em>|<strong>/);
});
