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
