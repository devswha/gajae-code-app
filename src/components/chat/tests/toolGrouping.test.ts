import assert from 'node:assert/strict';
import test from 'node:test';

import { groupConsecutiveTools, hasFailedResult, isToolGroupItem } from '../utils/toolGrouping';
import type { ChatMessage } from '../types/types';

/**
 * Grouping collapses repetition so a long turn stays scannable.
 *
 * Excluding shell commands was tried and reverted: one call and several then
 * looked alike, but a long turn rendered a hundred separate command rows and
 * the transcript got harder to read than before. The count stays; the commands
 * are one click away.
 */

const toolCall = (toolName: string, id: string): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: new Date('2026-08-26T09:00:00Z'),
  isToolUse: true,
  toolName,
  toolId: id,
} as ChatMessage);

const thinking = (id: string): ChatMessage => ({
  type: 'assistant',
  content: 'reasoning',
  timestamp: new Date('2026-08-26T09:00:00Z'),
  isThinking: true,
  toolId: id,
} as ChatMessage);

test('a run of reads collapses into one group', () => {
  const items = groupConsecutiveTools([toolCall('Read', 'a'), toolCall('Read', 'b')]);

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), true);
});

test('a run of shell commands collapses too, so a long turn stays scannable', () => {
  const items = groupConsecutiveTools([
    toolCall('Bash', 'a'),
    toolCall('Bash', 'b'),
    toolCall('Bash', 'c'),
  ]);

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), true);
});

test('a lone shell command stays a plain row', () => {
  // Below the threshold there is nothing to collapse, so the command shows.
  const items = groupConsecutiveTools([toolCall('Bash', 'only')]);

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), false);
});

test('a different tool between runs breaks them apart', () => {
  const items = groupConsecutiveTools([
    toolCall('Read', 'a'),
    toolCall('Bash', 'b'),
    toolCall('Read', 'c'),
  ]);

  // Three lone calls: no two adjacent entries share a tool name.
  assert.equal(items.length, 3);
  assert.equal(items.some(isToolGroupItem), false);
});

test('hidden reasoning still does not split a groupable run', () => {
  // Providers interleave reasoning between tool calls; with thinking hidden it
  // renders nothing and must not break an otherwise continuous run.
  const items = groupConsecutiveTools(
    [toolCall('Read', 'a'), thinking('t'), toolCall('Read', 'b')],
    'balanced',
  );

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), true);
});

test('detailed never folds: every call keeps its own card', () => {
  const items = groupConsecutiveTools(
    [toolCall('Bash', 'a'), toolCall('Bash', 'b'), toolCall('Bash', 'c')],
    'detailed',
  );

  assert.equal(items.length, 3);
  assert.equal(items.some(isToolGroupItem), false);
});

test('detailed shows reasoning, so a thought between calls is a row of its own', () => {
  const items = groupConsecutiveTools(
    [toolCall('Read', 'a'), thinking('t'), toolCall('Read', 'b')],
    'detailed',
  );

  assert.equal(items.length, 3);
  assert.equal((items[1] as ChatMessage).isThinking, true);
});

test('compact folds even a lone call into a row', () => {
  const items = groupConsecutiveTools([toolCall('Bash', 'only')], 'compact');

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), true);
  assert.equal(isToolGroupItem(items[0]) && items[0].messages.length, 1);
});

test('compact keeps runs of different tools as separate rows', () => {
  const items = groupConsecutiveTools(
    [toolCall('Read', 'a'), toolCall('Bash', 'b'), toolCall('Bash', 'c')],
    'compact',
  );

  assert.equal(items.length, 2);
  assert.equal(items.every(isToolGroupItem), true);
  assert.deepEqual(items.map((item) => isToolGroupItem(item) && item.messages.length), [1, 2]);
});

test('a subagent container is never folded, whatever the level', () => {
  const subagent = { ...toolCall('Task', 's'), isSubagentContainer: true } as ChatMessage;

  for (const density of ['compact', 'balanced', 'detailed'] as const) {
    const items = groupConsecutiveTools([subagent, subagent], density);
    assert.equal(items.some(isToolGroupItem), false, density);
  }
});

test('the default level is balanced', () => {
  const run = [toolCall('Read', 'a'), toolCall('Read', 'b')];

  assert.deepEqual(groupConsecutiveTools(run), groupConsecutiveTools(run, 'balanced'));
});

test('a failed call is what a folded group must never hide', () => {
  const failed = { ...toolCall('Bash', 'x'), toolResult: { content: 'boom', isError: true } } as ChatMessage;

  assert.equal(hasFailedResult(failed), true);
  assert.equal(hasFailedResult(toolCall('Bash', 'ok')), false);
  assert.equal(hasFailedResult({ ...toolCall('Bash', 'ok'), toolResult: { content: 'fine', isError: false } } as ChatMessage), false);
});
