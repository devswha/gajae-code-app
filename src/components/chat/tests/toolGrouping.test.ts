import assert from 'node:assert/strict';
import test from 'node:test';

import { groupConsecutiveTools, isToolGroupItem } from '../utils/toolGrouping';
import type { ChatMessage } from '../types/types';

/**
 * Grouping collapses repetition, which reads well when a run differs only by
 * target. It reads badly for shell commands: each one is a different
 * instruction, so folding a run behind a count made the same work look
 * different depending on how many happened to land in a row - the transcript
 * appeared to open and close at random.
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

test('consecutive shell commands each keep their own row', () => {
  const items = groupConsecutiveTools([
    toolCall('Bash', 'a'),
    toolCall('Bash', 'b'),
    toolCall('Bash', 'c'),
  ]);

  assert.equal(items.length, 3);
  assert.equal(items.some(isToolGroupItem), false);
});

test('a lone shell command renders exactly like one inside a run', () => {
  // The point of the change: one bash call and three bash calls produce the
  // same kind of row, so nothing appears to open or close on its own.
  const single = groupConsecutiveTools([toolCall('Bash', 'only')]);
  const run = groupConsecutiveTools([toolCall('Bash', 'a'), toolCall('Bash', 'b')]);

  assert.equal(single.every((item) => !isToolGroupItem(item)), true);
  assert.equal(run.every((item) => !isToolGroupItem(item)), true);
});

test('shell commands do not merge a surrounding run of another tool', () => {
  const items = groupConsecutiveTools([
    toolCall('Read', 'a'),
    toolCall('Bash', 'b'),
    toolCall('Read', 'c'),
  ]);

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
