import assert from 'node:assert/strict';
import test from 'node:test';

import { GjcBunAskController, selectPermissionOption } from './gjc-bun-ask-controller.js';

/** The selected arm of the runtime's outcome union. */
const kindOf = (outcome: { outcome: string; kind?: string }): string | undefined =>
  outcome.outcome === 'selected' ? outcome.kind : undefined;

/*
 * The browser's answer reaches the runtime as one of its own offered options.
 * "Always" pairs with both answers now: allow_always and reject_always - the
 * runtime keeps the memory for the rest of the run, so the card's Always deny
 * means "stop asking me about this tool", never a persisted project rule.
 */

type Writer = { sent: Array<Record<string, unknown>>; send(frame: Record<string, unknown>): void };
const writer = (): Writer => {
  const sent: Array<Record<string, unknown>> = [];
  return { sent, send: (frame) => { sent.push(frame); } };
};

const options = (kinds: string[]) => kinds.map((kind, index) => ({ optionId: `o-${index}`, kind, name: kind }) as never);

test('selectPermissionOption answers reject_always only when the runtime offered it', () => {
  const offered = options(['allow_once', 'reject_once', 'reject_always']);
  assert.equal(kindOf(selectPermissionOption(offered, 'reject_always') as never), 'reject_always');
  // Not offered: falls back to a plain rejection rather than an invalid answer.
  const plain = options(['allow_once', 'allow_always', 'reject_once']);
  assert.equal(kindOf(selectPermissionOption(plain, 'reject_always') as never), 'reject_once');
  assert.equal(kindOf(selectPermissionOption(plain, 'allow_always') as never), 'allow_always');
});

test('a denial with always resolves to the runtime\'s reject_always option', async () => {
  const out = writer();
  const controller = new GjcBunAskController(out as never);
  const decided = controller.requestPermission(
    { toolCallId: 'c1', toolName: 'bash', title: 'bash', rawInput: { command: 'rm -rf /' } } as never,
    options(['allow_once', 'reject_once', 'reject_always']),
  );
  const request = out.sent.find((frame) => frame.kind === 'permission_request') as { requestId: string; context: { options: string[] } };
  assert.deepEqual(request.context.options, ['allow_once', 'reject_once', 'reject_always']);

  assert.equal(controller.resolve(request.requestId, { allow: false, always: true }), true);
  assert.deepEqual(await decided, { outcome: 'selected', optionId: 'o-2', kind: 'reject_always' });
});

test('a denial without always stays a single rejection; an unoffered reject_always degrades', async () => {
  const out = writer();
  const controller = new GjcBunAskController(out as never);
  const decided = controller.requestPermission(
    { toolCallId: 'c1', toolName: 'bash', title: 'bash', rawInput: {} } as never,
    options(['allow_once', 'reject_once']),
  );
  const request = out.sent.find((frame) => frame.kind === 'permission_request') as { requestId: string };

  assert.equal(controller.resolve(request.requestId, { allow: false }), true);
  assert.equal(kindOf(await decided as never), 'reject_once');

  const second = controller.requestPermission(
    { toolCallId: 'c2', toolName: 'eval', title: 'eval', rawInput: {} } as never,
    options(['allow_once', 'reject_once']),
  );
  const secondRequest = out.sent.filter((frame) => frame.kind === 'permission_request')[1] as { requestId: string };
  controller.resolve(secondRequest.requestId, { allow: false, always: true });
  assert.equal(kindOf(await second as never), 'reject_once');
});
