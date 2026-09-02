import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../../../i18n/config';
import enChat from '../../../i18n/locales/en/chat.json';
import type { ChatMessage } from '../types/types';
import { toolOutputDensityRules } from '../utils/toolOutputDensity';
import type { ToolOutputDensity } from '../utils/toolOutputDensity';
import { buildPaneList, isTurnWorkBlockItem } from '../utils/turnWork';
import type { TurnWorkBlockItem } from '../utils/turnWork';
import TurnWorkBlock from '../view/TurnWorkBlock';

/*
 * The block's first paint: what the header says while running, once finished
 * and when something failed, and that the body starts folded at every level
 * that renders a block at all.
 */

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 2, 0, 0, seconds)).toISOString();
const user = (seconds: number): ChatMessage => ({ type: 'user', content: 'go', timestamp: at(seconds) });
const call = (toolName: string, seconds: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant', content: '', timestamp: at(seconds), isToolUse: true, toolName, toolId: `${toolName}-${seconds}`,
  toolInput: toolName === 'bash' ? { command: `cmd-${seconds}` } : { path: `src/${toolName}-${seconds}.ts` },
  toolResult: { content: 'fine', isError: false, timestamp: at(seconds + 1) }, ...extra,
});

const blockFor = (messages: ChatMessage[], density: ToolOutputDensity): TurnWorkBlockItem => {
  const block = buildPaneList(messages, density).find(isTurnWorkBlockItem);
  assert.ok(block, `${density} renders a work block`);
  return block;
};

const render = (block: TurnWorkBlockItem, density: ToolOutputDensity, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(TurnWorkBlock, {
  block,
  prevMessage: null,
  createDiff: () => [],
  provider: 'gjc',
  density,
  ...extra,
}));

const finishedTurn = [
  user(0),
  call('read', 1), call('read', 2), call('read', 3), call('read', 4), call('read', 5),
  call('bash', 10), call('bash', 12), call('bash', 14),
  call('edit', 20), call('write', 30, { toolResult: { content: 'ok', isError: false, timestamp: at(42) } }),
  { type: 'assistant', content: 'All done.', timestamp: at(42) } as ChatMessage,
];

test('finished: "Worked for 42s · 5 files read · 3 commands · 2 edits", folded, at both folding levels', () => {
  for (const density of ['compact', 'balanced'] as const) {
    const html = render(blockFor(finishedTurn, density), density);

    assert.match(html, /Worked for 42s/, density);
    assert.match(html, /5 files read · 3 commands · 2 edits/, density);
    assert.match(html, /aria-expanded="false"/, density);
    assert.match(html, /data-work-block="finished"/, density);
    // Folded means none of the rows inside are in the markup yet.
    assert.doesNotMatch(html, /src\/read-1\.ts/, density);
    assert.doesNotMatch(html, /cmd-10/, density);
    assert.doesNotMatch(html, new RegExp(enChat.tools.error), density);
    assert.doesNotMatch(html, /animate-pulse/, density);
  }
});

test('detailed has no block at all: the rule is off and the pane list is the message list', () => {
  assert.equal(toolOutputDensityRules('detailed').workBlock, false);
  assert.equal(toolOutputDensityRules('balanced').workBlock, true);
  assert.equal(toolOutputDensityRules('compact').workBlock, true);
  assert.equal(buildPaneList(finishedTurn, 'detailed').some(isTurnWorkBlockItem), false);
});

test('running: "<live activity>… · <elapsed>" with the pulse and no "Working" prefix, folded', () => {
  const live = [user(0), call('read', 1), call('bash', 2, { toolResult: null })];
  const html = render(blockFor(live, 'balanced'), 'balanced', {
    running: true,
    liveActivity: { kind: 'tool', category: 'command', toolName: 'bash', subject: 'npm test', moreCount: 0 },
    runStartedAt: Date.now(),
  });

  assert.doesNotMatch(html, /Working/);
  assert.match(html, /Running npm test…/);
  assert.match(html, /0s/);
  assert.match(html, /animate-pulse/);
  assert.match(html, /data-work-block="running"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Worked/);
  assert.doesNotMatch(html, /files read/);
});

test('running with nothing derived says Thinking; without a start time the elapsed segment is left out', () => {
  const live = [user(0), call('read', 1)];
  const html = render(blockFor(live, 'compact'), 'compact', { running: true });

  assert.doesNotMatch(html, /Working/);
  assert.match(html, /Thinking…/);
  assert.doesNotMatch(html, /\d+s</);
});

test('a failure is on the row - the error label and the failed count - and the body still stays folded', () => {
  const failing = [
    user(0),
    call('bash', 1, { toolResult: { content: 'exit 1: missing module', isError: true, timestamp: at(2) } }),
    call('read', 3),
    call('edit', 4, { toolResult: { content: 'no such file', isError: true, timestamp: at(5) } }),
  ];

  for (const density of ['compact', 'balanced'] as const) {
    const html = render(blockFor(failing, density), density);

    assert.ok(html.includes(enChat.tools.error), density);
    assert.match(html, /2 failed/, density);
    assert.match(html, /text-destructive/, density);
    // Balanced unfolds a failed *card* (failureOpens), but never the turn's
    // whole block: that row is what the reader gets, until they open it.
    assert.match(html, /aria-expanded="false"/, density);
    assert.doesNotMatch(html, /exit 1: missing module/, density);
    assert.match(html, /Worked for 5s/, density);
    assert.match(html, /1 file read · 1 command · 1 edit/, density);
  }
});

test('no usable timestamps: "Worked" without a duration rather than a made-up one', () => {
  const block: TurnWorkBlockItem = {
    _isWorkBlock: true,
    messages: [call('read', 1, { toolResult: { content: 'ok', isError: false } })],
    timestamp: at(1),
    startedAt: null,
    endedAt: null,
    isTail: true,
  };
  const html = render(block, 'balanced');

  assert.match(html, />Worked</);
  assert.doesNotMatch(html, /Worked for/);
  assert.match(html, /1 file read/);
});

test('the toggle is a labelled disclosure button that controls the body', () => {
  const html = render(blockFor(finishedTurn, 'balanced'), 'balanced');

  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.ok(html.includes(enChat.workBlock.toggle.replace("'", '&#x27;')));
});
