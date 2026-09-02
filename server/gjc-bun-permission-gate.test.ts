import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClientBridgePermissionOption, ClientBridgePermissionToolCall } from '@gajae-code/coding-agent/session/client-bridge';

import { GjcBunAskController, selectPermissionOption } from './gjc-bun-ask-controller.js';
import { createGjcPermissionProvider } from './gjc-bun-permission-gate.js';

/** The exact option list `AgentSession` hands its permission provider. */
const RUNTIME_OPTIONS: ClientBridgePermissionOption[] = [
  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
  { optionId: 'reject_always', name: 'Always reject', kind: 'reject_always' },
];

const bashCall = (command: string): ClientBridgePermissionToolCall => ({
  toolCallId: `call-${command}`,
  toolName: 'bash',
  title: command,
  kind: 'execute',
  status: 'pending',
  rawInput: { command },
});

type Sent = Record<string, unknown>;
function writer() {
  const sent: Sent[] = [];
  return { sent, send: (value: unknown) => { sent.push(value as Sent); } };
}

const requestIds = (sent: Sent[]) => sent.filter((m) => m.kind === 'permission_request').map((m) => m.requestId as string);

test('a tool the policy already covers is approved inside the worker, with one notice per tool', async () => {
  const out = writer();
  const asks = new GjcBunAskController(out);
  const provider = createGjcPermissionProvider({ mode: 'ask', allowAlways: ['bash'] }, asks, out);

  const first = await provider(bashCall('ls'), RUNTIME_OPTIONS);
  const second = await provider(bashCall('pwd'), RUNTIME_OPTIONS);

  assert.deepEqual(first, { outcome: 'selected', optionId: 'allow_once', kind: 'allow_once' });
  assert.deepEqual(second, first);
  // Nothing crossed to the browser, so the run is never reported as waiting.
  assert.deepEqual(requestIds(out.sent), []);
  assert.deepEqual(
    out.sent.filter((m) => m.kind === 'system_notice'),
    [{ kind: 'system_notice', level: 'info', content: 'Auto-approved bash (always allow)' }],
  );
});

test('bypass approves every gated tool and says so once per tool', async () => {
  const out = writer();
  const provider = createGjcPermissionProvider({ mode: 'bypass', allowAlways: [] }, new GjcBunAskController(out), out);

  await provider(bashCall('ls'), RUNTIME_OPTIONS);
  await provider({ toolCallId: 'e1', toolName: 'eval', title: 'eval', rawInput: {} }, RUNTIME_OPTIONS);
  await provider(bashCall('pwd'), RUNTIME_OPTIONS);

  assert.deepEqual(
    out.sent.filter((m) => m.kind === 'system_notice').map((m) => m.content),
    ['Auto-approved bash (bypass)', 'Auto-approved eval (bypass)'],
  );
});

test('a tool the policy does not cover becomes a permission card and waits for the decision', async () => {
  const out = writer();
  const asks = new GjcBunAskController(out);
  const provider = createGjcPermissionProvider({ mode: 'ask', allowAlways: [] }, asks, out);

  const pending = provider(bashCall('rm -rf build'), RUNTIME_OPTIONS);
  const [requestId] = requestIds(out.sent);
  assert.match(requestId, /^sdk-permission:/);
  const request = out.sent[0];
  assert.equal(request.toolName, 'bash', 'the card names the real tool, not "ask"');
  assert.deepEqual(request.input, { command: 'rm -rf build' });
  assert.deepEqual(request.context, {
    source: 'sdk-permission',
    toolCallId: 'call-rm -rf build',
    title: 'rm -rf build',
    kind: 'execute',
    options: ['allow_once', 'allow_always', 'reject_once', 'reject_always'],
  });

  assert.equal(asks.resolve(requestId, { allow: true, always: true }), true);
  assert.deepEqual(await pending, { outcome: 'selected', optionId: 'allow_always', kind: 'allow_always' });
  assert.equal(asks.resolve(requestId, { allow: true }), false, 'a decision is accepted once');
});

test('allow, deny and malformed decisions map onto the runtime\'s options', async () => {
  const out = writer();
  const asks = new GjcBunAskController(out);

  const allowed = asks.requestPermission(bashCall('a'), RUNTIME_OPTIONS);
  const denied = asks.requestPermission(bashCall('b'), RUNTIME_OPTIONS);
  const [allowId, denyId] = requestIds(out.sent);

  assert.equal(asks.resolve(allowId, { allow: 'yes' }), false, 'allow must be a boolean');
  assert.equal(asks.resolve(allowId, { allow: true }), true);
  assert.equal(asks.resolve(denyId, { allow: false, always: true }), true, 'always without allow is a plain rejection');

  assert.deepEqual(await allowed, { outcome: 'selected', optionId: 'allow_once', kind: 'allow_once' });
  assert.deepEqual(await denied, { outcome: 'selected', optionId: 'reject_once', kind: 'reject_once' });
});

test('an aborted or disposed request is cancelled and the card withdrawn', async () => {
  const out = writer();
  const asks = new GjcBunAskController(out);

  const controller = new AbortController();
  const aborted = asks.requestPermission(bashCall('a'), RUNTIME_OPTIONS, controller.signal);
  const disposed = asks.requestPermission(bashCall('b'), RUNTIME_OPTIONS);
  const [abortId, disposeId] = requestIds(out.sent);

  controller.abort();
  assert.deepEqual(await aborted, { outcome: 'cancelled' });
  assert.equal(asks.resolve(abortId, { allow: true }), false);

  asks.dispose();
  assert.deepEqual(await disposed, { outcome: 'cancelled' });
  assert.deepEqual(
    out.sent.filter((m) => m.kind === 'permission_cancelled').map((m) => m.requestId),
    [abortId, disposeId],
  );

  const late = new AbortController();
  late.abort();
  assert.deepEqual(await asks.requestPermission(bashCall('c'), RUNTIME_OPTIONS, late.signal), { outcome: 'cancelled' });
});

test('the chosen option comes from the runtime\'s list, falling back to the one-shot kind', () => {
  const withoutAlways = RUNTIME_OPTIONS.filter((option) => option.kind !== 'allow_always');
  assert.deepEqual(selectPermissionOption(withoutAlways, 'allow_always'), { outcome: 'selected', optionId: 'allow_once', kind: 'allow_once' });
  assert.equal(selectPermissionOption([], 'allow_once'), undefined);
});

test('ask questions and tool permissions share the controller without confusing each other', async () => {
  const out = writer();
  const asks = new GjcBunAskController(out);

  const question = asks.uiContext.select('Which one?', ['A', 'B']);
  const permission = asks.requestPermission(bashCall('ls'), RUNTIME_OPTIONS);
  const [askId, permissionId] = requestIds(out.sent);
  assert.match(askId, /^sdk-ask:/);
  assert.match(permissionId, /^sdk-permission:/);

  // A bare allow is still refused for a question: it carries no answer.
  assert.equal(asks.resolve(askId, { allow: true }), false);
  assert.equal(asks.resolve(askId, { allow: true, message: 'A' }), true);
  assert.equal(asks.resolve(permissionId, { allow: true }), true);
  assert.equal(await question, 'A');
  assert.deepEqual(await permission, { outcome: 'selected', optionId: 'allow_once', kind: 'allow_once' });
});
