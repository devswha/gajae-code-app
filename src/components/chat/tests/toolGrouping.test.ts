import assert from 'node:assert/strict';
import test from 'node:test';

import { groupConsecutiveTools, isToolGroupItem } from '../utils/toolGrouping';
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
    false,
  );

  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]), true);
});
