import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareHistoryMessagesForTransport } from '@/modules/providers/services/sessions.service.js';
import type { NormalizedMessage } from '@/shared/types.js';

const baseMessage = (overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: 'msg-1',
  sessionId: 'session-1',
  timestamp: '2026-08-13T00:00:00.000Z',
  provider: 'gjc',
  kind: 'text',
  ...overrides,
});

test('transport keeps small messages untouched and strips images only on request', () => {
  const withImage = baseMessage({ kind: 'text', role: 'user', images: [{ data: 'base64…' }] });
  const small = baseMessage({ id: 'msg-2', kind: 'tool_result', content: 'ok' });

  const kept = prepareHistoryMessagesForTransport([withImage, small]);
  assert.equal(kept[0], withImage);
  assert.equal(kept[1], small);

  const stripped = prepareHistoryMessagesForTransport([withImage, small], false);
  assert.equal(stripped[0].images, undefined);
  // Small tool output stays byte-identical either way.
  assert.equal(stripped[1].content, 'ok');
  assert.equal(stripped[1].toolResultTruncated, undefined);
});

test('transport truncates oversized tool output without splitting UTF-8 characters', () => {
  const output = `시작-${'x'.repeat(90_000)}-끝`;
  const [prepared] = prepareHistoryMessagesForTransport([
    baseMessage({ kind: 'tool_result', content: output }),
  ]);

  assert.equal(prepared.toolResultTruncated, true);
  assert.equal(prepared.toolResultBytes, Buffer.byteLength(output));
  assert.ok(String(prepared.content).length < output.length);
  assert.equal(String(prepared.content).includes('\uFFFD'), false);
  assert.equal(String(prepared.content).startsWith('시작-'), true);
  assert.equal(String(prepared.content).endsWith('-끝'), true);
  assert.match(String(prepared.content), /bytes omitted/u);
});

test('transport truncates the folded toolResult on tool_use messages too', () => {
  const output = `한글${'y'.repeat(90_000)}한글`;
  const [prepared] = prepareHistoryMessagesForTransport([
    baseMessage({
      kind: 'tool_use',
      toolName: 'bash',
      toolId: 'call-1',
      toolResult: { content: output, isError: false },
    }),
  ]);

  assert.equal(prepared.toolResultTruncated, true);
  assert.equal(prepared.toolResultBytes, Buffer.byteLength(output));
  const preview = String(prepared.toolResult?.content);
  assert.ok(preview.length < output.length);
  assert.equal(preview.includes('\uFFFD'), false);
  assert.equal(preview.startsWith('한글'), true);
  assert.equal(preview.endsWith('한글'), true);
});

/*
 * Structured tool details.
 *
 * The runtime returns `{ content, details }` per tool call. Only `content` used
 * to survive the adapter, so a card could do nothing but re-parse a string the
 * server had just serialized. Details now ride `toolUseResult`, which means the
 * transport has to bound them: a read's details embed the whole file under
 * `truncation.content`, duplicating what the text side already caps.
 */

test('transport passes small tool details through untouched', () => {
  const message = baseMessage({
    id: 'msg-details',
    kind: 'tool_result',
    content: 'ok',
    toolUseResult: { resolvedPath: '/repo/AGENTS.md', kind: 'file' },
  });

  const [prepared] = prepareHistoryMessagesForTransport([message]);

  assert.deepEqual(prepared.toolUseResult, { resolvedPath: '/repo/AGENTS.md', kind: 'file' });
  assert.equal(prepared.toolDetailsOmitted, undefined);
});

test('transport drops oversized tool details whole rather than trimming them', () => {
  // A trimmed object is worse than none: a consumer cannot tell which fields
  // went missing, so it would render confidently wrong.
  const message = baseMessage({
    id: 'msg-huge',
    kind: 'tool_result',
    content: 'ok',
    toolUseResult: { truncation: { content: 'x'.repeat(64 * 1024) }, resolvedPath: '/repo/big' },
  });

  const [prepared] = prepareHistoryMessagesForTransport([message]);

  assert.equal(prepared.toolUseResult, undefined);
  assert.equal(prepared.toolDetailsOmitted, true);
});

test('a dropped detail is distinguishable from a tool that reported none', () => {
  const none = baseMessage({ id: 'msg-none', kind: 'tool_result', content: 'ok' });

  const [prepared] = prepareHistoryMessagesForTransport([none]);

  assert.equal(prepared.toolUseResult, undefined);
  // Absent, not omitted. A card must be able to tell these apart before it
  // decides whether to show a "details unavailable" affordance.
  assert.equal(prepared.toolDetailsOmitted, undefined);
});

test('unserializable tool details are dropped instead of crossing the transport', () => {
  const cyclic: Record<string, unknown> = { resolvedPath: '/repo/x' };
  cyclic.self = cyclic;
  const message = baseMessage({
    id: 'msg-cyclic',
    kind: 'tool_result',
    content: 'ok',
    toolUseResult: cyclic,
  });

  assert.doesNotThrow(() => prepareHistoryMessagesForTransport([message]));
  const [prepared] = prepareHistoryMessagesForTransport([message]);
  assert.equal(prepared.toolUseResult, undefined);
  assert.equal(prepared.toolDetailsOmitted, true);
});

test('bounding details leaves the text truncation flags alone', () => {
  // The two budgets describe different fields and must not be conflated.
  const message = baseMessage({
    id: 'msg-both',
    kind: 'tool_result',
    content: 'ok',
    toolUseResult: { truncation: { content: 'x'.repeat(64 * 1024) } },
  });

  const [prepared] = prepareHistoryMessagesForTransport([message]);

  assert.equal(prepared.toolDetailsOmitted, true);
  assert.equal(prepared.toolResultTruncated, undefined);
  assert.equal(prepared.toolResultBytes, undefined);
  assert.equal(prepared.content, 'ok');
});

test('transport bounds details folded into a tool_use as well as standalone ones', () => {
  // History drops the standalone tool_result row and folds its details into the
  // call, so bounding only the top-level field would leave the larger of the
  // two shapes uncapped.
  const message = baseMessage({
    id: 'msg-folded',
    kind: 'tool_use',
    toolName: 'read',
    toolResult: {
      content: 'ok',
      isError: false,
      toolUseResult: { truncation: { content: 'x'.repeat(64 * 1024) } },
    },
  });

  const [prepared] = prepareHistoryMessagesForTransport([message]);

  assert.equal(prepared.toolResult?.toolUseResult, undefined);
  assert.equal(prepared.toolDetailsOmitted, true);
  // The text beside it is untouched; the two budgets are independent.
  assert.equal(prepared.toolResult?.content, 'ok');
  assert.equal(prepared.toolResultTruncated, undefined);
});

test('transport keeps small folded details', () => {
  const message = baseMessage({
    id: 'msg-folded-small',
    kind: 'tool_use',
    toolName: 'read',
    toolResult: { content: 'ok', isError: false, toolUseResult: { resolvedPath: '/repo/x' } },
  });

  const [prepared] = prepareHistoryMessagesForTransport([message]);

  assert.deepEqual(prepared.toolResult?.toolUseResult, { resolvedPath: '/repo/x' });
  assert.equal(prepared.toolDetailsOmitted, undefined);
});
