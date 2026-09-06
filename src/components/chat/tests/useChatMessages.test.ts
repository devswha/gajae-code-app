import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import { normalizedToChatMessages } from '../hooks/useChatMessages';
import { isToolCallRunning } from '../utils/toolActivity';
import { assignMessageKeys } from '../utils/messageKeys';

/*
 * The conversion is what the transcript renders from, and the pane's rows
 * are memoised on the objects it returns. A row that did not change must
 * convert to the same object, or every streamed delta re-renders the whole
 * session; a row that did change - or a call whose result landed - must not.
 */

const row = (extra: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: extra.id ?? `id-${Math.random()}`, sessionId: 's', timestamp: '2026-09-02T00:00:00Z', provider: 'gjc', kind: 'text', ...extra,
});

test('an unchanged row converts to the same ChatMessage object on the next pass', () => {
  const user = row({ id: 'u', role: 'user', content: 'hi' });
  const call = row({ id: 'c', kind: 'tool_use', toolId: 't1', toolName: 'read', toolInput: { path: 'a.ts' } });
  const answer = row({ id: 'a', role: 'assistant', content: 'done' });
  const first = normalizedToChatMessages([user, call, answer]);

  // The streaming row is replaced; everything else is the same object.
  const streaming = (content: string) => row({ id: '__streaming_s', kind: 'stream_delta', content });
  const second = normalizedToChatMessages([user, call, answer, streaming('he')]);
  const third = normalizedToChatMessages([user, call, answer, streaming('hello')]);

  assert.equal(second[0], first[0]);
  assert.equal(second[1], first[1]);
  assert.equal(second[2], first[2]);
  assert.equal(third[3].content, 'hello');
  assert.notEqual(third[3], second[3]);
  assert.equal(third[3].isStreaming, true);
});

test('a call converts again when its result lands, whether inline or as its own row', () => {
  const call = row({ id: 'c', kind: 'tool_use', toolId: 't1', toolName: 'read', toolInput: { path: 'a.ts' } });
  const pending = normalizedToChatMessages([call])[0];
  assert.equal(pending.toolResult, null);
  assert.equal(pending.id, 'c');
  assert.equal(pending.toolId, 't1');

  const result = row({ id: 'r', kind: 'tool_result', toolId: 't1', content: 'contents', isError: false });
  const [paired, ...rest] = normalizedToChatMessages([call, result]);
  assert.equal(rest.length, 0, 'the result row folds into the call');
  assert.notEqual(paired, pending);
  assert.equal(paired.toolResult?.content, 'contents');

  // The same pairing on the next pass is the same object.
  assert.equal(normalizedToChatMessages([call, result])[0], paired);

  // A later result row for the same call supersedes the earlier one.
  const updated = row({ id: 'r2', kind: 'tool_result', toolId: 't1', content: 'more', isError: false });
  const [superseded] = normalizedToChatMessages([call, result, updated]);
  assert.notEqual(superseded, paired);
  assert.equal(superseded.toolResult?.content, 'more');

  // An inline result is the row's own: a new row object, a new conversion.
  const inline = { ...call, toolResult: { content: 'inline', isError: false } };
  const [own] = normalizedToChatMessages([inline]);
  assert.notEqual(own, pending);
  assert.equal(own.toolResult?.content, 'inline');
  for (const message of [paired, superseded, own]) {
    assert.equal(message.id, 'c', 'the tool call retains its persisted row ID when its result changes');
    assert.equal(message.toolId, 't1', 'row identity does not replace the tool pairing ID');
  }
});

test('prepending text with the same timestamp and content prefix keeps distinct row IDs and keys', () => {
  const prefix = 'The same leading text that exceeds the forty-eight character key preview: ';
  const existing = row({ id: 'existing', role: 'assistant', content: `${prefix}existing` });
  const first = normalizedToChatMessages([existing]);
  const firstKeys = assignMessageKeys(first);
  const older = row({ id: 'older', role: 'assistant', content: `${prefix}older` });
  const prepended = normalizedToChatMessages([older, existing]);
  const prependedKeys = assignMessageKeys(prepended);

  assert.equal(older.timestamp, existing.timestamp);
  assert.deepEqual(prepended.map((message) => message.id), ['older', 'existing']);
  assert.equal(prepended[1], first[0]);
  assert.equal(prependedKeys(prepended[1]), firstKeys(first[0]));
  assert.notEqual(prependedKeys(prepended[0]), prependedKeys(prepended[1]));
});

test('changing a text row replaces its output without changing its ID or key', () => {
  const original = row({ id: 'answer', role: 'assistant', content: 'Before' });
  const first = normalizedToChatMessages([original]);
  const updated = normalizedToChatMessages([{ ...original, content: 'After' }]);

  assert.notEqual(updated[0], first[0]);
  assert.equal(updated[0].content, 'After');
  assert.equal(updated[0].id, original.id);
  assert.equal(assignMessageKeys(updated)(updated[0]), assignMessageKeys(first)(first[0]));
});

test('a text row that yields two messages yields the same two next time', () => {
  const notice = row({
    id: 'n', role: 'user',
    content: '<task-notification><status>completed</status><summary>Done</summary><result>All green</result></task-notification>',
  });
  const first = normalizedToChatMessages([notice]);
  assert.deepEqual(first.map((message) => message.content), ['Done', 'All green']);
  assert.deepEqual(first.map((message) => message.id), ['n', 'n:result']);
  const second = normalizedToChatMessages([notice]);
  assert.equal(second[0], first[0]);
  assert.equal(second[1], first[1]);

  const updated = normalizedToChatMessages([{
    ...notice,
    content: '<task-notification><status>failed</status><summary>Failed</summary><result>One failure</result></task-notification>',
  }]);
  assert.deepEqual(updated.map((message) => message.content), ['Failed', 'One failure']);
  assert.deepEqual(updated.map((message) => message.id), first.map((message) => message.id));
  assert.notEqual(updated[0], first[0]);
  assert.notEqual(updated[1], first[1]);

  const summaryOnly = normalizedToChatMessages([{
    ...notice,
    content: '<task-notification><status>running</status><summary>Working</summary></task-notification>',
  }]);
  assert.equal(summaryOnly.length, 1);
  assert.equal(summaryOnly[0].id, first[0].id, 'the summary keeps its identity when a result appears or disappears');
});

test('partial tool results preserve their running state through chat conversion', () => {
  for (const toolName of ['bash', 'Task']) {
    const call = row({ kind: 'tool_use', toolId: 'partial-tool', toolName, toolInput: {} });
    const partial = row({ kind: 'tool_result', toolId: 'partial-tool', content: '', isError: false, isFinal: false });
    const running = normalizedToChatMessages([call, partial])[0];
    assert.equal(running.toolResult?.isFinal, false);
    assert.equal(isToolCallRunning(running), true);
    if (toolName === 'Task') assert.equal(running.subagentState?.isComplete, false);
    const final = row({ kind: 'tool_result', toolId: 'partial-tool', content: '', isError: false, isFinal: true });
    const finished = normalizedToChatMessages([call, partial, final])[0];
    assert.equal(isToolCallRunning(finished), false);
    if (toolName === 'Task') assert.equal(finished.subagentState?.isComplete, true);
  }
});
