import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GjcSdkBridge,
  extractGjcTokenBudget,
  getPendingGjcApprovalsForSession,
  resolveGjcToolApproval,
} from './gjc-sdk-bridge.js';
import type { GjcSdkFrame } from './gjc-sdk-client.js';

class FakeSdkClient {
  readonly replies: Array<{ id: string; answer: unknown }> = [];
  readonly controls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  readonly queries: string[] = [];
  readonly #listeners = new Set<(frame: GjcSdkFrame) => void>();
  contextResponse: unknown = { items: [{ usage: { tokens: 120, contextWindow: 1_000, source: 'provider_anchor' } }] };
  usageResponse: unknown = { items: [{ input: 80, output: 20, cacheRead: 15, cacheWrite: 5, cost: 0.01 }] };
  closed = false;
  controlError?: Error;
  queryError?: Error;
  replyError?: Error;

  onFrame(listener: (frame: GjcSdkFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async control(operation: string, input: Record<string, unknown> = {}): Promise<unknown> {
    if (this.controlError) throw this.controlError;
    this.controls.push({ operation, input });
    return { accepted: true };
  }

  async query(query: string): Promise<unknown> {
    if (this.queryError) throw this.queryError;
    this.queries.push(query);
    return query === 'context.get' ? this.contextResponse : this.usageResponse;
  }

  reply(id: string, answer: unknown): void {
    if (this.replyError) throw this.replyError;
    this.replies.push({ id, answer });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emit(frame: GjcSdkFrame): void {
    for (const listener of this.#listeners) listener(frame);
  }
}

type Outbound = Record<string, unknown>;

function createWriter(): { messages: Outbound[]; send(value: unknown): void } {
  const messages: Outbound[] = [];
  return {
    messages,
    send(value: unknown) {
      assert.ok(value && typeof value === 'object' && !Array.isArray(value));
      messages.push(value as Outbound);
    },
  };
}

test('GjcSdkBridge presents SDK asks through the existing question panel and resolves replies', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  const bridge = new GjcSdkBridge(client, 'session-one', writer);

  client.emit({
    type: 'action_needed',
    id: 'action-1',
    kind: 'ask',
    question: 'Choose a target',
    options: ['Alpha', 'Beta'],
  });

  const request = writer.messages.at(-1);
  assert.equal(request?.kind, 'permission_request');
  assert.equal(request?.toolName, 'AskUserQuestion');
  assert.equal(request?.sessionId, 'session-one');
  assert.deepEqual(request?.input, {
    questions: [{
      question: 'Choose a target',
      header: 'GJC',
      options: [{ label: 'Alpha' }, { label: 'Beta' }],
      multiSelect: false,
    }],
  });

  const requestId = request?.requestId;
  assert.equal(typeof requestId, 'string');
  assert.equal(getPendingGjcApprovalsForSession('session-one').length, 1);
  assert.equal(resolveGjcToolApproval(requestId as string, {
    allow: true,
    updatedInput: { answers: { 'Choose a target': 'Beta' } },
  }), true);
  assert.deepEqual(client.replies, [{ id: 'action-1', answer: 'Beta' }]);

  client.emit({ type: 'action_resolved', id: 'action-1', resolvedBy: 'client' });
  assert.equal(writer.messages.at(-1)?.kind, 'permission_cancelled');
  assert.equal(getPendingGjcApprovalsForSession('session-one').length, 0);
  await bridge.close();
});

test('GjcSdkBridge deduplicates replayed asks and re-presents rejected replies', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  const bridge = new GjcSdkBridge(client, 'session-replay', writer);
  const action: GjcSdkFrame = {
    type: 'action_needed',
    id: 'action-replay',
    kind: 'ask',
    question: 'Proceed?',
    options: ['Yes', 'No'],
  };

  client.emit(action);
  const firstRequestId = writer.messages.at(-1)?.requestId;
  client.emit(action);
  assert.equal(writer.messages.at(-1)?.requestId, firstRequestId);
  assert.equal(getPendingGjcApprovalsForSession('session-replay').length, 1);

  assert.equal(resolveGjcToolApproval(firstRequestId as string, {
    allow: false,
    updatedInput: { answers: { 'Proceed?': 'Yes' } },
  }), true);
  assert.deepEqual(client.replies.at(-1), { id: 'action-replay', answer: 'No' });
  client.emit({
    type: 'reply_rejected',
    id: 'action-replay',
    reason: 'already_answered',
  });
  assert.equal(writer.messages.at(-1)?.kind, 'permission_request');
  assert.deepEqual(writer.messages.at(-1)?.context, {
    source: 'gjc-sdk',
    replyRejected: 'already_answered',
  });
  await bridge.close();
});
test('GjcSdkBridge normalizes ask options and preserves decision fallbacks', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  const bridge = new GjcSdkBridge(client, 'session-fallbacks', writer);

  client.emit({
    type: 'action_needed',
    id: 'action-allow-fallback',
    kind: 'ask',
    question: '   ',
    options: [
      '  Alpha  ',
      { name: ' Beta ', description: ' second choice ' },
      { label: '   ' },
      42,
    ],
  });
  const allowRequest = writer.messages.at(-1);
  assert.deepEqual(allowRequest?.input, {
    questions: [{
      question: 'GJC needs your input',
      header: 'GJC',
      options: [
        { label: 'Alpha' },
        { label: 'Beta', description: 'second choice' },
      ],
      multiSelect: false,
    }],
  });
  assert.equal(resolveGjcToolApproval(allowRequest?.requestId as string, {
    allow: true,
    message: '   ',
  }), true);
  assert.deepEqual(client.replies.at(-1), {
    id: 'action-allow-fallback',
    answer: 'Skip',
  });
  client.emit({ type: 'action_resolved', id: 'action-allow-fallback' });

  client.emit({
    type: 'action_needed',
    id: 'action-deny-fallback',
    kind: 'ask',
    question: 'Continue?',
    options: ['Proceed'],
  });
  const denyRequest = writer.messages.at(-1);
  assert.equal(resolveGjcToolApproval(denyRequest?.requestId as string, {
    allow: false,
    message: '   ',
  }), true);
  assert.deepEqual(client.replies.at(-1), {
    id: 'action-deny-fallback',
    answer: 'No',
  });
  assert.equal(resolveGjcToolApproval('missing-request', { allow: true }), false);

  await bridge.close();
});

test('pending asks with the same provider action id remain isolated by application session', async () => {
  const firstClient = new FakeSdkClient();
  const secondClient = new FakeSdkClient();
  const firstWriter = createWriter();
  const secondWriter = createWriter();
  const firstBridge = new GjcSdkBridge(firstClient, 'session-first', firstWriter);
  const secondBridge = new GjcSdkBridge(secondClient, 'session-second', secondWriter);
  const action: GjcSdkFrame = {
    type: 'action_needed',
    id: 'shared-action',
    kind: 'ask',
    question: 'Choose',
    options: ['One', 'Two'],
  };

  firstClient.emit(action);
  secondClient.emit(action);
  assert.equal(getPendingGjcApprovalsForSession('session-first').length, 1);
  assert.equal(getPendingGjcApprovalsForSession('session-second').length, 1);

  await firstBridge.close();
  assert.equal(getPendingGjcApprovalsForSession('session-first').length, 0);
  assert.equal(getPendingGjcApprovalsForSession('session-second').length, 1);
  assert.equal(resolveGjcToolApproval(secondWriter.messages.at(-1)?.requestId as string, {
    allow: true,
    message: 'Two',
  }), true);
  assert.deepEqual(secondClient.replies, [{ id: 'shared-action', answer: 'Two' }]);

  await secondBridge.close();
});

test('SDK failures remain contained and rejected replies are re-presented', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  const bridge = new GjcSdkBridge(client, 'session-sdk-failure', writer);

  client.controlError = new Error('transport failed');
  assert.equal(await bridge.abort(), false);
  client.queryError = new Error('usage unavailable');
  await bridge.emitTokenBudget();
  assert.equal(writer.messages.length, 0);

  client.emit({
    type: 'action_needed',
    id: 'action-reply-failure',
    kind: 'ask',
    question: 'Proceed?',
    options: ['Yes', 'No'],
  });
  const requestId = writer.messages.at(-1)?.requestId as string;
  client.replyError = new Error('connection closed');
  assert.equal(resolveGjcToolApproval(requestId, {
    allow: true,
    message: 'Yes',
  }), true);
  assert.equal(writer.messages.at(-1)?.requestId, requestId);
  assert.deepEqual(writer.messages.at(-1)?.context, {
    source: 'gjc-sdk',
    replyRejected: 'connection_closed',
  });
  assert.equal(getPendingGjcApprovalsForSession('session-sdk-failure').length, 1);

  await bridge.close();
  assert.equal(getPendingGjcApprovalsForSession('session-sdk-failure').length, 0);
});

test('GjcSdkBridge uses SDK abort and emits normalized token-budget status', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  const bridge = new GjcSdkBridge(client, 'session-usage', writer);

  assert.equal(await bridge.abort(), true);
  assert.deepEqual(client.controls, [{ operation: 'turn.abort', input: {} }]);
  await bridge.emitTokenBudget();
  assert.deepEqual(client.queries, ['context.get', 'usage.get']);

  const status = writer.messages.at(-1);
  assert.equal(status?.kind, 'status');
  assert.equal(status?.text, 'token_budget');
  assert.deepEqual(status?.tokenBudget, {
    used: 120,
    total: 1_000,
    inputTokens: 80,
    outputTokens: 20,
    cacheReadTokens: 15,
    cacheCreationTokens: 5,
    cacheTokens: 20,
    breakdown: { input: 80, output: 20 },
    cost: 0.01,
    source: 'provider_anchor',
  });
  await bridge.close();
  assert.equal(client.closed, true);
});

test('GjcSdkBridge suppresses late usage after close begins', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  let resolveQueries!: (value: unknown) => void;
  const pendingQueries = new Promise<unknown>((resolve) => {
    resolveQueries = resolve;
  });
  client.contextResponse = pendingQueries;
  client.usageResponse = pendingQueries;
  const bridge = new GjcSdkBridge(client, 'session-late-usage', writer);

  const emission = bridge.emitTokenBudget();
  await Promise.resolve();
  const closing = bridge.close();
  resolveQueries({
    items: [{
      usage: { tokens: 120, contextWindow: 1_000 },
      input: 80,
      output: 20,
    }],
  });
  await Promise.all([emission, closing]);

  assert.equal(writer.messages.length, 0);
});

test('extractGjcTokenBudget returns null without observed usage', () => {
  assert.equal(extractGjcTokenBudget({ items: [{}] }, { items: [{}] }), null);
});

test('closing a bridge cancels and removes its pending asks', async () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  const bridge = new GjcSdkBridge(client, 'session-close', writer);
  client.emit({
    type: 'action_needed',
    id: 'action-close',
    kind: 'ask',
    question: 'Wait?',
    options: [],
  });

  await bridge.close();
  assert.equal(writer.messages.at(-1)?.kind, 'permission_cancelled');
  assert.equal(getPendingGjcApprovalsForSession('session-close').length, 0);
  assert.equal(client.closed, true);
});

test('transport closure cancels pending asks without waiting for process cleanup', () => {
  const client = new FakeSdkClient();
  const writer = createWriter();
  new GjcSdkBridge(client, 'session-transport-close', writer);
  client.emit({
    type: 'action_needed',
    id: 'action-transport-close',
    kind: 'ask',
    question: 'Still there?',
    options: ['Yes', 'No'],
  });

  client.emit({ type: 'transport_closed', reason: 'connection' });

  assert.equal(writer.messages.at(-1)?.kind, 'permission_cancelled');
  assert.equal(getPendingGjcApprovalsForSession('session-transport-close').length, 0);
});

test('throwing writers cannot block bridge cleanup or client close', async () => {
  const client = new FakeSdkClient();
  const bridge = new GjcSdkBridge(client, 'session-writer-throws', {
    send() {
      throw new Error('socket closed');
    },
  });
  client.emit({
    type: 'action_needed',
    id: 'action-writer-throws',
    kind: 'ask',
    question: 'Proceed?',
    options: [],
  });

  await bridge.close();

  assert.equal(client.closed, true);
  assert.equal(getPendingGjcApprovalsForSession('session-writer-throws').length, 0);
});
