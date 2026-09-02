import assert from 'node:assert/strict';
import test from 'node:test';

import i18n from '../../../i18n/config';
import type { ChatMessage } from '../types/types';
import { groupConsecutiveTools, isToolGroupItem } from '../utils/toolGrouping';
import type { MessageListItem } from '../utils/toolGrouping';
import { TOOL_OUTPUT_DENSITIES } from '../utils/toolOutputDensity';
import { buildPaneList, foldTurnWork, formatTurnWorkCounts, isPendingWorkBlock, isTurnWorkBlockItem, summarizeTurnWork } from '../utils/turnWork';
import type { PaneListItem, TurnWorkBlockItem } from '../utils/turnWork';

/*
 * The work block is a pure fold over the message list: which runs of tool
 * calls become blocks, what stays outside, and what the summary row counts.
 */

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 2, 0, 0, seconds)).toISOString();
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'chat', ...options }) as string;

const user = (content: string, seconds: number): ChatMessage => ({ type: 'user', content, timestamp: at(seconds) });
const text = (content: string, seconds: number): ChatMessage => ({ type: 'assistant', content, timestamp: at(seconds) });
const thought = (seconds: number): ChatMessage => ({ type: 'assistant', content: 'hmm', timestamp: at(seconds), isThinking: true });
const call = (toolName: string, seconds: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant', content: '', timestamp: at(seconds), isToolUse: true, toolName, toolInput: { path: `${toolName}.ts` }, toolId: `${toolName}-${seconds}`,
  toolResult: { content: 'ok', isError: false }, ...extra,
});
const failedCall = (toolName: string, seconds: number) => call(toolName, seconds, { toolResult: { content: 'boom', isError: true } });

const label = (item: PaneListItem | ChatMessage | TurnWorkBlockItem | MessageListItem): string => {
  if (isTurnWorkBlockItem(item as PaneListItem)) return `[work ${(item as TurnWorkBlockItem).messages.map(label).join(' ')}]`;
  if (isToolGroupItem(item as MessageListItem)) return `{${(item as { messages: ChatMessage[] }).messages.map(label).join(' ')}}`;
  const message = item as ChatMessage;
  if (message.isToolUse) return String(message.toolName);
  if (message.isThinking) return 'thought';
  return `${message.type}:${message.content}`;
};

test('a turn with tool calls folds each run of consecutive calls into one block', () => {
  const items = foldTurnWork([
    user('go', 0),
    text('Let me look.', 1),
    call('read', 2),
    call('bash', 3),
    text('Done.', 4),
  ], 'balanced');

  assert.deepEqual(items.map(label), ['user:go', 'assistant:Let me look.', '[work read bash]', 'assistant:Done.']);
  const block = items[2] as TurnWorkBlockItem;
  // The block's clock starts at the prose before it, not the user message.
  assert.equal(block.startedAt, at(1));
  assert.equal(block.endedAt, at(4));
  assert.equal(block.isTail, true);
});

test('prose between calls stays outside, in order, and cuts the work into one block per run of calls', () => {
  // What the model says is never behind a fold: the turn reads as prose and
  // work alternating, the way Codex and Cursor lay it out.
  const items = foldTurnWork([
    user('go', 0),
    call('read', 1),
    text('Found it, now checking the tests.', 2),
    call('bash', 3),
    call('bash', 4),
    text('All green.', 5),
  ]);

  assert.deepEqual(items.map(label), [
    'user:go', '[work read]', 'assistant:Found it, now checking the tests.', '[work bash bash]', 'assistant:All green.',
  ]);
  const blocks = items.filter(isTurnWorkBlockItem);
  assert.deepEqual(blocks.map((block) => [block.startedAt, block.endedAt]), [[at(0), at(2)], [at(2), at(5)]]);
  // Only the last block can be the one a run is working on.
  assert.deepEqual(blocks.map((block) => block.isTail), [false, true]);

  // A call arriving after that prose does not move it: it opens a new block below.
  const later = foldTurnWork([
    user('go', 0),
    call('read', 1),
    text('Found it, now checking the tests.', 2),
    call('bash', 3),
    text('All green.', 4),
    call('edit', 5),
  ]);
  assert.deepEqual(later.map(label), [
    'user:go', '[work read]', 'assistant:Found it, now checking the tests.', '[work bash]', 'assistant:All green.', '[work edit]',
  ]);
  assert.deepEqual(later.filter(isTurnWorkBlockItem).map((block) => block.isTail), [false, false, true]);
});

test('reasoning is not work: a thought between calls is hoisted ahead of the block and does not split it', () => {
  const items = foldTurnWork([user('go', 0), call('read', 1), thought(2), call('bash', 3)]);
  assert.deepEqual(items.map(label), ['user:go', 'thought', '[work read bash]']);

  // A thought after the run's last call falls outside, after the block.
  const trailing = foldTurnWork([user('go', 0), call('read', 1), thought(2), text('so', 3), thought(4)]);
  assert.deepEqual(trailing.map(label), ['user:go', '[work read]', 'thought', 'assistant:so', 'thought']);
});

test('every turn gets its own block, and only the last turn can be the live one', () => {
  const items = foldTurnWork([
    user('first', 0), call('read', 1), text('a', 2),
    user('second', 3), text('no tools here', 4),
    user('third', 5), call('bash', 6),
  ]);

  assert.deepEqual(items.map(label), [
    'user:first', '[work read]', 'assistant:a',
    'user:second', 'assistant:no tools here',
    'user:third', '[work bash]',
  ]);
  const blocks = items.filter(isTurnWorkBlockItem);
  assert.deepEqual(blocks.map((block) => block.isTail), [false, true]);
  assert.deepEqual(blocks.map((block) => block.startedAt), [at(0), at(5)]);
  assert.deepEqual(blocks.map((block) => block.endedAt), [at(2), null]);
});

test('a window that starts mid-turn still folds, without a turn start', () => {
  const items = foldTurnWork([call('read', 1), call('bash', 2), text('done', 3)]);

  assert.deepEqual(items.map(label), ['[work read bash]', 'assistant:done']);
  assert.equal((items[0] as TurnWorkBlockItem).startedAt, null);
});

test('a lone read is still a block: one rule, no special case', () => {
  assert.deepEqual(foldTurnWork([user('go', 0), call('read', 1)]).map(label), ['user:go', '[work read]']);
});

test('a live turn has a block before its first tool call: empty, at the end of the turn', () => {
  // The moment the user message is sent there is a block to say "Thinking".
  const justSent = foldTurnWork([user('go', 0)], 'balanced', { running: true });
  assert.deepEqual(justSent.map(label), ['user:go', '[work ]']);
  const block = justSent[1] as TurnWorkBlockItem;
  assert.equal(isPendingWorkBlock(block), true);
  assert.equal(block.isTail, true);
  assert.equal(block.startedAt, at(0));
  assert.equal(block.endedAt, null);
  assert.equal(block.timestamp, at(0));

  // Prose before the first call stays above the block, as it does once a call lands.
  const narrating = foldTurnWork([user('go', 0), text('Let me look.', 1)], 'balanced', { running: true });
  assert.deepEqual(narrating.map(label), ['user:go', 'assistant:Let me look.', '[work ]']);
  assert.equal((narrating[2] as TurnWorkBlockItem).timestamp, at(1));

  // The first call takes the block's place; nothing is pending any more.
  const started = foldTurnWork([user('go', 0), text('Let me look.', 1), call('read', 2)], 'balanced', { running: true });
  assert.deepEqual(started.map(label), ['user:go', 'assistant:Let me look.', '[work read]']);
  assert.equal(isPendingWorkBlock(started[2] as TurnWorkBlockItem), false);
  assert.equal((started[2] as TurnWorkBlockItem).isTail, true);

  // Prose after a block closes it - it reads `Worked for` - and a new empty
  // block follows the prose until the run says what comes next.
  const narratingAgain = foldTurnWork([user('go', 0), call('read', 1), text('Found it.', 2)], 'balanced', { running: true });
  assert.deepEqual(narratingAgain.map(label), ['user:go', '[work read]', 'assistant:Found it.', '[work ]']);
  assert.deepEqual(narratingAgain.filter(isTurnWorkBlockItem).map((block) => block.isTail), [false, true]);
  assert.equal((narratingAgain[3] as TurnWorkBlockItem).startedAt, at(2));
  // The next call fills it in place.
  const secondRun = foldTurnWork([user('go', 0), call('read', 1), text('Found it.', 2), call('edit', 3)], 'balanced', { running: true });
  assert.deepEqual(secondRun.map(label), ['user:go', '[work read]', 'assistant:Found it.', '[work edit]']);
  assert.deepEqual(secondRun.filter(isTurnWorkBlockItem).map((block) => [isPendingWorkBlock(block), block.isTail]), [[false, false], [false, true]]);

  // Only the last turn can be live: earlier tool-less turns never get one.
  const history = foldTurnWork([user('first', 0), text('no tools', 1), user('second', 2)], 'compact', { running: true });
  assert.deepEqual(history.map(label), ['user:first', 'assistant:no tools', 'user:second', '[work ]']);

  // The pane list carries it through, after whatever was grouped before it.
  assert.deepEqual(buildPaneList([user('go', 0)], 'compact', { running: true }).map(label), ['user:go', '[work ]']);
  // Even a window with nothing in it yet has the row while a run is going.
  assert.deepEqual(buildPaneList([], 'balanced', { running: true }).map(label), ['[work ]']);
});

test('a turn that finishes with no tool call has no block: the answer stands alone', () => {
  const pureText = [user('go', 0), text('Sure, here is the answer.', 1)];
  for (const density of TOOL_OUTPUT_DENSITIES) {
    assert.deepEqual(buildPaneList(pureText, density).map(label), ['user:go', 'assistant:Sure, here is the answer.'], density);
    assert.deepEqual(buildPaneList(pureText, density, { running: false }).map(label), ['user:go', 'assistant:Sure, here is the answer.'], density);
  }
  // While it streams there is one; when the run ends it is gone.
  assert.deepEqual(buildPaneList(pureText, 'balanced', { running: true }).map(label), ['user:go', 'assistant:Sure, here is the answer.', '[work ]']);
  assert.equal(buildPaneList(pureText, 'balanced', { running: false }).some(isTurnWorkBlockItem), false);
  // A block with calls in it is never pending, whatever the run state says;
  // while running, the prose after it gets the pending one.
  const finished = buildPaneList([user('go', 0), call('read', 1), text('done', 2)], 'balanced', { running: true });
  assert.deepEqual(finished.filter(isTurnWorkBlockItem).map(isPendingWorkBlock), [false, true]);
  assert.deepEqual(buildPaneList([user('go', 0), call('read', 1), text('done', 2)], 'balanced').filter(isTurnWorkBlockItem).map(isPendingWorkBlock), [false]);
});

test('detailed never folds, live or not: the pane renders a running row of its own instead', () => {
  const live = [user('go', 0), call('read', 1, { toolResult: null })];
  assert.deepEqual(buildPaneList(live, 'detailed', { running: true }).map(label), ['user:go', 'read']);
  assert.deepEqual(buildPaneList([user('go', 0)], 'detailed', { running: true }).map(label), ['user:go']);
  assert.equal(buildPaneList([], 'detailed', { running: true }).length, 0);
});

test('the block is on at compact and balanced and off at detailed', () => {
  const messages = [user('go', 0), call('read', 1), call('read', 2), text('done', 3)];

  assert.deepEqual(buildPaneList(messages, 'compact').map(label), ['user:go', '[work read read]', 'assistant:done']);
  assert.deepEqual(buildPaneList(messages, 'balanced').map(label), ['user:go', '[work read read]', 'assistant:done']);
  // Detailed: the cards at the top level, never grouped, exactly as before.
  assert.deepEqual(buildPaneList(messages, 'detailed').map(label), ['user:go', 'read', 'read', 'assistant:done']);
  assert.equal(foldTurnWork(messages, 'detailed'), messages);
  for (const density of TOOL_OUTPUT_DENSITIES) {
    assert.equal(buildPaneList([], density).length, 0, density);
  }
});

test('a subagent container is work like any other call, and the top level without blocks is the old list', () => {
  const subagent = call('Task', 2, { isSubagentContainer: true, toolInput: { description: 'Look' } });
  const messages = [call('read', 1), subagent, call('read', 3), call('read', 4)];

  assert.deepEqual(buildPaneList(messages, 'balanced').map(label), ['[work read Task read read]']);
  // Detailed never folds or groups, so the pane list is the message list.
  assert.deepEqual(buildPaneList(messages, 'detailed').map(label), ['read', 'Task', 'read', 'read']);
  // A block's contents are grouped when opened, by the same rules: the two
  // trailing reads fold into one row at balanced, the container never does.
  const [block] = buildPaneList(messages, 'balanced') as TurnWorkBlockItem[];
  assert.deepEqual(groupConsecutiveTools(block.messages, 'balanced').map(label), ['read', 'Task', '{read read}']);
  assert.deepEqual(groupConsecutiveTools(block.messages, 'compact').map(label), ['{read}', 'Task', '{read read}']);
});

test('the summary counts calls by category, edits and writes together', () => {
  const summary = summarizeTurnWork({
    messages: [
      call('read', 1), call('read', 2), call('Read', 3),
      call('search', 4), call('find', 5),
      call('bash', 6), call('bash', 7), call('bash', 8),
      call('edit', 9), call('write', 10),
      call('web_search', 11),
      call('Task', 12, { isSubagentContainer: true }),
      call('todo_write', 13),
      text('narration is not counted', 14),
    ],
    startedAt: null,
    endedAt: null,
  });

  assert.equal(summary.total, 13);
  assert.deepEqual(summary.counts, { read: 3, search: 2, command: 3, edit: 1, write: 1, web: 1, subagent: 1, other: 1 });
  assert.equal(summary.failed, 0);
  assert.deepEqual(formatTurnWorkCounts(summary, t), [
    '3 files read', '2 searches', '3 commands', '2 edits', '1 web lookup', '1 subagent', '1 other tool',
  ]);
});

test('the summary omits zero counts and pluralises the rest', () => {
  const one = summarizeTurnWork({ messages: [call('read', 1), call('bash', 2)], startedAt: null, endedAt: null });
  assert.deepEqual(formatTurnWorkCounts(one, t), ['1 file read', '1 command']);

  const many = summarizeTurnWork({ messages: [call('edit', 1), call('edit', 2), call('search', 3)], startedAt: null, endedAt: null });
  assert.deepEqual(formatTurnWorkCounts(many, t), ['1 search', '2 edits']);
});

test('failures are counted, whatever the tool', () => {
  const summary = summarizeTurnWork({
    messages: [failedCall('bash', 1), call('read', 2), failedCall('edit', 3), call('bash', 4, { toolResult: null })],
    startedAt: null,
    endedAt: null,
  });

  assert.equal(summary.failed, 2);
  assert.equal(summary.total, 4);
});

test('the duration runs from the block start to the last thing the transcript saw', () => {
  // Block started at 0, last result at 42: worked for 42s.
  const withResults = summarizeTurnWork({
    messages: [
      call('read', 5, { toolResult: { content: '', isError: false, timestamp: at(7) } }),
      call('bash', 10, { toolResult: { content: '', isError: false, timestamp: at(42) } }),
    ],
    startedAt: at(0),
    endedAt: null,
  });
  assert.equal(withResults.durationMs, 42_000);

  // The answer's own timestamp extends it when it is later still.
  const withAnswer = summarizeTurnWork({ messages: [call('read', 5)], startedAt: at(0), endedAt: at(50) });
  assert.equal(withAnswer.durationMs, 50_000);

  // No start in the window: measured from the first call instead.
  const midWindow = summarizeTurnWork({ messages: [call('read', 5), call('bash', 30)], startedAt: null, endedAt: null });
  assert.equal(midWindow.durationMs, 25_000);

  // Each block of a turn measures its own run: from the prose before it to the prose after.
  const [first, second] = foldTurnWork([
    user('go', 0), call('read', 5), text('Found it.', 12), call('edit', 20), text('Done.', 25),
  ]).filter(isTurnWorkBlockItem);
  assert.equal(summarizeTurnWork(first).durationMs, 12_000);
  assert.equal(summarizeTurnWork(second).durationMs, 13_000);
});

test('a duration is omitted rather than guessed when the timestamps cannot support one', () => {
  // A single instant is not a duration.
  assert.equal(summarizeTurnWork({ messages: [call('read', 5)], startedAt: null, endedAt: null }).durationMs, null);
  assert.equal(summarizeTurnWork({ messages: [call('read', 5)], startedAt: at(5), endedAt: null }).durationMs, null);
  // Unparseable timestamps are ignored, not turned into NaN.
  const garbage = summarizeTurnWork({
    messages: [call('read', 1, { timestamp: 'not a date', toolResult: { content: '', isError: false, timestamp: 'nope' } })],
    startedAt: 'when?',
    endedAt: null,
  });
  assert.equal(garbage.durationMs, null);
  // Out-of-order clocks (end before start) give nothing rather than a negative.
  assert.equal(summarizeTurnWork({ messages: [call('read', 1)], startedAt: at(9), endedAt: null }).durationMs, null);
});
