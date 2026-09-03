import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import type { NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';

test('live writer bounds oversized tool results before buffering and sending', () => {
  const sent: string[] = [];
  const decorated: NormalizedMessage[] = [];
  const connection = {
    readyState: 1,
    send(value: string) {
      sent.push(value);
    },
  } as unknown as RealtimeClientConnection;

  const writer = new ChatSessionWriter({
    connection,
    appSessionId: 'app-session',
    userId: null,
    provider: 'gjc',
    providerSessionId: 'provider-session',
    onProviderSessionId() {},
    onSessionTitle() {},
    decorateOutboundEvent(message) {
      decorated.push(message);
      return { ...message, sessionId: 'app-session', seq: 1 };
    },
  });

  const output = `시작-${'x'.repeat(100_000)}-끝`;
  writer.send({
    id: 'result-1',
    sessionId: 'provider-session',
    timestamp: '2026-08-21T00:00:00.000Z',
    provider: 'gjc',
    kind: 'tool_result',
    toolId: 'computer-1',
    content: output,
  } satisfies NormalizedMessage);

  const [buffered] = decorated;
  assert.ok(buffered);
  assert.equal(buffered.toolResultTruncated, true);
  assert.equal(buffered.toolResultBytes, Buffer.byteLength(output));
  assert.ok(String(buffered.content).length < output.length);
  assert.equal(sent.length, 1);
  const outbound = JSON.parse(sent[0]) as NormalizedMessage;
  assert.equal(outbound.toolResultTruncated, true);
  assert.match(String(outbound.content), /bytes omitted/u);
  assert.equal(String(outbound.content).includes('\uFFFD'), false);
});

test('a session_title message is handed to the app and never published as chat', () => {
  const sent: string[] = [];
  const titles: string[] = [];
  const writer = new ChatSessionWriter({
    connection: { readyState: 1, send(value: string) { sent.push(value); } } as unknown as RealtimeClientConnection,
    appSessionId: 'app-session',
    userId: null,
    provider: 'gjc',
    providerSessionId: 'provider-session',
    onProviderSessionId() {},
    onSessionTitle(title) { titles.push(title); },
    decorateOutboundEvent(message) { return { ...message, sessionId: 'app-session', seq: 1 }; },
  });

  writer.send({ kind: 'session_title', title: '  Boot order race  ', source: 'auto', sessionId: 'provider-session' });
  writer.send({ kind: 'session_title', title: '   ', source: 'auto', sessionId: 'provider-session' });
  writer.send({ kind: 'session_title', source: 'auto', sessionId: 'provider-session' });

  assert.deepEqual(titles, ['Boot order race']);
  assert.equal(sent.length, 0);
});
