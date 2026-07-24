import assert from 'node:assert/strict';
import test from 'node:test';

import { forwardPromptTerminal, forwardSdkEvent, type SdkRunState } from './gjc-bun-sdk-events.js';

type Sent = Record<string, unknown>;

function collector() {
  const messages: Sent[] = [];
  const writer = { send: (value: unknown) => { messages.push(value as Sent); } };
  const state: SdkRunState = { abortRequested: false, abortPending: false, terminalEmitted: false, finalError: false };
  return { messages, writer, state };
}

function forward(events: unknown[]) {
  const { messages, writer, state } = collector();
  for (const event of events) forwardSdkEvent(event, writer, state);
  return { messages, state, writer };
}

const first = (messages: Sent[], kind: string) => messages.find((message) => message.kind === kind);
const all = (messages: Sent[], kind: string) => messages.filter((message) => message.kind === kind);

/*
 * The mapped field names are the whole point of this module: the browser reads
 * `toolId`/`toolInput`/`content`, so emitting the SDK's own `toolCallId`/`args`/
 * `result` names renders an empty tool card and an "Unknown error" row without
 * failing anywhere. These assertions pin the contract.
 */

test('tool_execution_start emits the app tool_use contract, not SDK field names', () => {
  const { messages } = forward([
    { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' }, intent: 'List the directory' },
  ]);

  const toolUse = first(messages, 'tool_use');
  assert.ok(toolUse, 'a tool_use message is emitted');
  assert.equal(toolUse.toolId, 'call-1');
  assert.deepEqual(toolUse.toolInput, { command: 'ls' });
  assert.equal(toolUse.toolName, 'bash');
  assert.equal(toolUse.displayText, 'List the directory');
  assert.ok(!('toolCallId' in toolUse), 'the SDK id field never reaches the browser contract');
  assert.ok(!('args' in toolUse), 'the SDK args field never reaches the browser contract');
});

test('tool_execution_start without an intent omits displayText entirely', () => {
  const { messages } = forward([{ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read', args: {} }]);
  assert.ok(!('displayText' in first(messages, 'tool_use')!));
});

test('tool_execution_end pairs its result to the tool_use by toolId', () => {
  const { messages } = forward([
    { type: 'tool_execution_start', toolCallId: 'call-7', toolName: 'read', args: { path: 'a.ts' } },
    // The SDK always wraps a result in an AgentToolResult envelope.
    { type: 'tool_execution_end', toolCallId: 'call-7', toolName: 'read', result: { content: [{ type: 'text', text: 'file body' }] }, isError: false },
  ]);

  const toolResult = first(messages, 'tool_result');
  assert.ok(toolResult);
  assert.equal(toolResult.toolId, 'call-7', 'shares the tool_use id so the UI can attach it');
  assert.equal(toolResult.content, 'file body', 'the envelope is flattened, not serialized');
  assert.equal(toolResult.isError, false);
});

test('multi-part tool output is concatenated in order', () => {
  const { messages } = forward([
    { type: 'tool_execution_end', toolCallId: 'c', toolName: 'bash', result: { content: [{ type: 'text', text: 'line1\n' }, { type: 'text', text: 'line2' }], details: { exitCode: 0 } }, isError: false },
  ]);
  assert.equal(first(messages, 'tool_result')!.content, 'line1\nline2');
});

test('an image tool result never inlines its base64 payload', () => {
  const bytes = 'A'.repeat(4096);
  const { messages } = forward([
    { type: 'tool_execution_end', toolCallId: 'c', toolName: 'read', result: { content: [{ type: 'image', data: bytes, mimeType: 'image/png' }] }, isError: false },
  ]);

  const content = String(first(messages, 'tool_result')!.content);
  assert.ok(!content.includes(bytes), 'base64 must never become chat text');
  assert.equal(content, '[image]');
});

test('a tool result that is a bare content array is flattened too', () => {
  const { messages } = forward([
    { type: 'tool_execution_end', toolCallId: 'c', toolName: 'grep', result: [{ type: 'text', text: 'match' }], isError: false },
  ]);
  assert.equal(first(messages, 'tool_result')!.content, 'match');
});

test('an unrecognized result shape still serializes rather than vanishing', () => {
  const { messages } = forward([
    { type: 'tool_execution_end', toolCallId: 'call-8', toolName: 'grep', result: { matches: 2 }, isError: false },
  ]);
  assert.equal(first(messages, 'tool_result')!.content, JSON.stringify({ matches: 2 }, null, 2));
});

test('tool_execution_update forwards late output such as a backgrounded job result', () => {
  const { messages } = forward([
    { type: 'tool_execution_start', toolCallId: 'bg-1', toolName: 'bash', args: { command: 'sleep 60' } },
    { type: 'tool_execution_end', toolCallId: 'bg-1', toolName: 'bash', result: 'Background job started', isError: false },
    // The SDK names this payload `partialResult`, and it carries no error flag.
    { type: 'tool_execution_update', toolCallId: 'bg-1', toolName: 'bash', args: {}, partialResult: { content: [{ type: 'text', text: 'done' }] } },
  ]);

  const results = all(messages, 'tool_result');
  assert.equal(results.length, 2);
  assert.equal(results[1].toolId, 'bg-1', 'the later result replaces the earlier one under the same id');
  assert.equal(results[1].content, 'done');
  assert.equal(results[1].isError, false);
});

test('an empty tool_execution_update emits nothing', () => {
  const { messages } = forward([{ type: 'tool_execution_update', toolCallId: 'x', args: {}, partialResult: undefined }]);
  assert.equal(all(messages, 'tool_result').length, 0);
});

test('a failed turn forwards the provider reason instead of the fixed string', () => {
  const { messages, state } = forward([
    { type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'context window exceeded', content: [] } },
  ]);

  assert.equal(state.finalError, true);
  assert.equal(first(messages, 'error')!.content, 'context window exceeded');
});

test('a failed turn with no reason still falls back to the safe fixed string', () => {
  const { messages } = forward([
    { type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [] } },
  ]);
  assert.equal(first(messages, 'error')!.content, 'GJC run failed.');
});

test('an SDK-side abort is recorded so a truncated turn cannot read as complete', () => {
  const { messages } = forward([
    { type: 'message_end', message: { role: 'assistant', stopReason: 'aborted', errorMessage: 'stream idle timeout', content: [{ text: 'partial' }] } },
  ]);

  assert.equal(first(messages, 'stream_end')!.content, 'partial');
  const notice = first(messages, 'system_notice');
  assert.ok(notice, 'the abort is surfaced');
  assert.equal(notice.level, 'warning');
  assert.equal(notice.content, 'stream idle timeout');
});

test('a user-requested stop is not reported back as an unexpected interruption', () => {
  const { messages, writer } = collector();
  // The adapter sets abortPending synchronously, then awaits session.abort();
  // the SDK emits the aborted message_end inside that await.
  const state: SdkRunState = { abortRequested: false, abortPending: true, terminalEmitted: false, finalError: false };
  forwardSdkEvent(
    { type: 'message_end', message: { role: 'assistant', stopReason: 'aborted', content: [{ text: 'partial' }] } },
    writer,
    state,
  );

  assert.equal(all(messages, 'system_notice').length, 0, 'the user already knows they pressed Stop');
  assert.equal(first(messages, 'stream_end')!.content, 'partial', 'the partial answer is still kept');
});

test('an ordinary completed turn emits no notice', () => {
  const { messages } = forward([
    { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ text: 'done' }] } },
  ]);
  assert.equal(all(messages, 'system_notice').length, 0);
});

test('usage is translated onto the token-budget shape the composer reads', () => {
  const { messages } = forward([
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ text: 'hi' }],
        usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3, totalTokens: 128 },
      },
    },
  ]);

  const budget = messages.find((message) => message.text === 'token_budget')?.tokenBudget as Record<string, unknown>;
  assert.ok(budget, 'a token budget is emitted');
  assert.equal(budget.used, 128, 'TokenUsageSummary reads `used`, not `totalTokens`');
  assert.equal(budget.inputTokens, 100);
  assert.equal(budget.outputTokens, 20);
  assert.equal(budget.cacheTokens, 8);
  assert.deepEqual(budget.breakdown, { input: 100, output: 20 });
});

test('a zero-token usage emits no budget rather than an empty pill', () => {
  const { messages } = forward([
    { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } },
  ]);
  assert.equal(messages.some((message) => message.text === 'token_budget'), false);
});

test('auto-compaction reports its phase and its outcome', () => {
  const { messages } = forward([
    { type: 'auto_compaction_start', reason: 'overflow', action: 'context-full' },
    { type: 'auto_compaction_end', action: 'context-full', result: {}, aborted: false, willRetry: false },
  ]);

  assert.match(String(first(messages, 'status')!.text), /Context overflow detected/);
  assert.equal(first(messages, 'system_notice')!.level, 'info');
});

test('a finished phase clears its activity label instead of leaving it stuck', () => {
  const compaction = forward([
    { type: 'auto_compaction_start', reason: 'overflow', action: 'context-full' },
    { type: 'auto_compaction_end', action: 'context-full', result: {}, aborted: false, willRetry: false },
  ]);
  assert.equal(all(compaction.messages, 'status').at(-1)!.text, '');

  const retry = forward([
    { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: 'overloaded' },
    { type: 'auto_retry_end', success: true, attempt: 1 },
  ]);
  assert.equal(all(retry.messages, 'status').at(-1)!.text, '');
});

test('a cancelled compaction is reported as cancelled, not as a failure', () => {
  const { messages } = forward([{ type: 'auto_compaction_end', action: 'context-full', aborted: true, willRetry: false }]);
  const notice = first(messages, 'system_notice')!;
  assert.equal(notice.level, 'info');
  assert.match(String(notice.content), /cancelled/i);
});

test('a benign skipped compaction stays silent', () => {
  const { messages } = forward([{ type: 'auto_compaction_end', action: 'context-full', skipped: true, aborted: false, willRetry: false }]);
  assert.equal(all(messages, 'system_notice').length, 0);
});

test('a recovery that will not auto-continue says so, rather than reading as success', () => {
  const { messages } = forward([{
    type: 'auto_compaction_end',
    action: 'context-full',
    result: {},
    aborted: false,
    willRetry: false,
    continuationSkipReason: 'auto_continue_disabled_non_resumable_tail',
  }]);

  const notice = first(messages, 'system_notice')!;
  assert.equal(notice.level, 'warning');
  assert.match(String(notice.content), /not resumed/i);
});

test('auto-retry surfaces the attempt, the delay, and the reason', () => {
  const { messages } = forward([
    { type: 'auto_retry_start', attempt: 2, maxAttempts: 5, delayMs: 4000, errorMessage: 'overloaded' },
  ]);

  const text = String(first(messages, 'status')!.text);
  assert.match(text, /2\/5/);
  assert.match(text, /4s/);
  assert.match(text, /overloaded/);
});

test('only an exhausted retry leaves a row behind', () => {
  // The SDK names these `success` and `finalError`.
  assert.equal(all(forward([{ type: 'auto_retry_end', success: true, attempt: 2 }]).messages, 'system_notice').length, 0);
  const exhausted = forward([{ type: 'auto_retry_end', success: false, attempt: 5, finalError: 'still overloaded' }]);
  const notice = first(exhausted.messages, 'system_notice')!;
  assert.equal(notice.level, 'error');
  assert.equal(notice.content, 'still overloaded');
});

test('a model fallback is recorded because the user did not choose it', () => {
  const { messages } = forward([
    { type: 'model_fallback_switched', from: 'opus', to: 'sonnet', reason: 'rate limited' },
  ]);

  const notice = first(messages, 'system_notice')!;
  assert.equal(notice.level, 'warning');
  assert.match(String(notice.content), /from opus to sonnet/);
  assert.match(String(notice.content), /rate limited/);
});

test('notice level maps onto the notice severities and keeps its source', () => {
  const { messages } = forward([
    { type: 'notice', level: 'error', message: 'quota exhausted', source: 'billing' },
    { type: 'notice', level: 'warning', message: 'slow provider' },
    { type: 'notice', level: 'info', message: 'plugin loaded' },
  ]);

  const notices = all(messages, 'system_notice');
  assert.deepEqual(notices.map((notice) => notice.level), ['error', 'warning', 'info']);
  assert.equal(notices[0].content, 'billing: quota exhausted');
});

test('an empty notice is dropped rather than rendered as a blank row', () => {
  assert.equal(all(forward([{ type: 'notice', level: 'info', message: '   ' }]).messages, 'system_notice').length, 0);
});

test('oversized provider text is bounded before it reaches the browser', () => {
  const { messages } = forward([{ type: 'notice', level: 'error', message: 'x'.repeat(5000) }]);
  const content = String(first(messages, 'system_notice')!.content);
  assert.ok(content.length < 5000);
  assert.ok(content.endsWith('…'));
});

test('a user-requested abort suppresses every event, as before', () => {
  const { messages, writer } = collector();
  const state: SdkRunState = { abortRequested: true, terminalEmitted: false, finalError: false };
  forwardSdkEvent({ type: 'notice', level: 'error', message: 'ignored' }, writer, state);
  forwardSdkEvent({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'b', args: {} }, writer, state);
  forwardPromptTerminal(writer, state);
  assert.equal(messages.length, 0);
});

test('unknown event types are still ignored without throwing', () => {
  const { messages } = forward([{ type: 'goal_updated', goal: 'x' }, { type: 'turn_start' }, {}]);
  assert.equal(messages.length, 0);
});

test('the terminal failure text stays on the field the browser renders', () => {
  const { messages, writer, state } = collector();
  forwardPromptTerminal(writer, state, new Error('super-secret stderr /cwd argv'));
  const error = first(messages, 'error')!;
  assert.equal(error.content, 'GJC run failed.');
  assert.ok(!JSON.stringify(messages).includes('super-secret'), 'raw runtime text is never forwarded');
  assert.equal(first(messages, 'complete')!.exitCode, 1);
});
