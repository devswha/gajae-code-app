import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import '../../../i18n/config';
import enChat from '../../../i18n/locales/en/chat.json';
import type { ChatMessage } from '../types/types';
import type { ToolOutputDensity } from '../utils/toolOutputDensity';

import ChatMessagesPane from './ChatMessagesPane';

/*
 * The block folds and unfolds on a click, keeps the cards inside working, and
 * disappears when the level switches to detailed - all state and events, so
 * this mounts the real pane in a DOM.
 */

afterEach(cleanup);

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 2, 0, 0, seconds)).toISOString();
const call = (toolName: string, seconds: number, toolInput: unknown, isError = false): ChatMessage => ({
  type: 'assistant', content: '', timestamp: at(seconds), isToolUse: true, toolName, toolInput, toolId: `${toolName}-${seconds}`,
  toolResult: { content: isError ? 'exit 1: missing module' : 'fine', isError, timestamp: at(seconds + 1) },
});

const transcript: ChatMessage[] = [
  { type: 'user', content: 'go', timestamp: at(0) },
  call('read', 1, { path: 'src/alpha.ts' }),
  call('read', 2, { path: 'src/beta.ts' }),
  call('bash', 3, { command: 'npm test' }, true),
  { type: 'assistant', content: 'All done here.', timestamp: at(10) },
];

const paneProps = (density: ToolOutputDensity, messages = transcript) => ({
  scrollContainerRef: { current: null },
  onWheel: () => {},
  onTouchMove: () => {},
  isLoadingSessionMessages: false,
  chatMessages: messages,
  selectedSession: { id: 's1', provider: 'gjc' as const },
  currentSessionId: 's1',
  provider: 'gjc' as const,
  isLoadingMoreMessages: false,
  hasMoreMessages: false,
  totalMessages: messages.length,
  sessionMessagesCount: messages.length,
  visibleMessageCount: messages.length,
  visibleMessages: messages,
  loadEarlierMessages: () => {},
  loadAllMessages: () => {},
  allMessagesLoaded: true,
  isLoadingAllMessages: false,
  loadAllJustFinished: false,
  showLoadAllOverlay: false,
  createDiff: () => [],
  density,
  selectedProject: { displayName: 'demo', fullPath: '/demo', projectId: 'demo' },
});

const toggle = () => screen.getByRole('button', { name: enChat.workBlock.toggle });

test('the block opens on a click to the rows the pane would have shown, and closes again', () => {
  render(createElement(ChatMessagesPane, paneProps('balanced')));

  const button = toggle();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.match(button.textContent ?? '', /Worked for 10s/);
  assert.match(button.textContent ?? '', /2 files read · 1 command/);
  assert.match(button.textContent ?? '', new RegExp(`${enChat.tools.error}.*1 failed`));
  // Folded: the answer is on the page, the rows are not.
  assert.ok(screen.getByText('All done here.'));
  assert.equal(screen.queryByText('src/alpha.ts'), null);
  assert.equal(screen.queryByText(/npm test/), null);

  fireEvent.click(button);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const body = document.getElementById(button.getAttribute('aria-controls') ?? '');
  assert.ok(body, 'the body the toggle controls is in the DOM');
  // Balanced folds the two reads into one group row and opens the failed
  // shell command on the spot, as it does outside a block.
  const groupRow = within(body).getByRole('button', { expanded: false });
  assert.match(groupRow.textContent ?? '', /Read.*×2/);
  assert.ok(within(body).getByText(/npm test/));
  assert.ok(within(body).getByText(/exit 1: missing module/));

  // The card's own fold still works inside the block.
  fireEvent.click(groupRow);
  assert.equal(groupRow.getAttribute('aria-expanded'), 'true');
  assert.ok(within(body).getByText('alpha.ts'));
  assert.ok(within(body).getByText('beta.ts'));

  fireEvent.click(button);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByText('alpha.ts'), null);
});

test('compact folds the block too, and its failure stays folded inside once opened', () => {
  render(createElement(ChatMessagesPane, paneProps('compact')));

  const button = toggle();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  fireEvent.click(button);
  const body = document.getElementById(button.getAttribute('aria-controls') ?? '');
  assert.ok(body);
  // Compact: every row a folded group, the failed one marked but closed.
  const rows = within(body).getAllByRole('button', { expanded: false });
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => (row.textContent ?? '').includes(enChat.tools.error)));
  assert.equal(within(body).queryByText(/exit 1: missing module/), null);
});

test('switching to detailed removes the block and puts the cards back at the top level; switching back restores it', () => {
  const view = render(createElement(ChatMessagesPane, paneProps('balanced')));
  assert.ok(toggle());

  view.rerender(createElement(ChatMessagesPane, paneProps('detailed')));
  assert.equal(screen.queryByRole('button', { name: enChat.workBlock.toggle }), null);
  // Detailed: each call is its own card, open, with the failed command's output.
  assert.ok(screen.getByText('alpha.ts'));
  assert.ok(screen.getByText('beta.ts'));
  assert.ok(screen.getByText(/exit 1: missing module/));
  assert.equal(screen.queryByText(/×2/), null);

  view.rerender(createElement(ChatMessagesPane, paneProps('compact')));
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByText('alpha.ts'), null);
});

test('a live run: the last turn\'s block says what is happening, earlier turns stay finished', () => {
  const messages: ChatMessage[] = [
    ...transcript,
    { type: 'user', content: 'now fix it', timestamp: at(20) },
    call('edit', 21, { path: 'src/alpha.ts', edits: [] }),
    { ...call('bash', 22, { command: 'npm run lint' }), toolResult: null },
  ];
  render(createElement(ChatMessagesPane, {
    ...paneProps('balanced', messages),
    isProcessing: true,
    liveActivity: { kind: 'tool', category: 'command', toolName: 'bash', subject: 'npm run lint', moreCount: 0 },
    runStartedAt: Date.now() - 12_000,
  }));

  const blocks = screen.getAllByRole('button', { name: enChat.workBlock.toggle });
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].textContent ?? '', /Worked for 10s/);
  assert.match(blocks[1].textContent ?? '', /Working/);
  assert.match(blocks[1].textContent ?? '', /Running npm run lint…/);
  assert.match(blocks[1].textContent ?? '', /12s/);
  assert.equal(blocks[1].getAttribute('aria-expanded'), 'false');
});
