import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GjcBunAskController } from './gjc-bun-ask-controller.js';

/*
 * The decision shapes the question panel sends, checked against the controller
 * that receives them rather than against an assumption about it.
 *
 * An answerless `{ allow: true }` is refused on purpose: `resolve` returns
 * false, the request stays pending, and the adapter reads that false as "no run
 * owns this id". So a reply in that shape does not decline the question — it
 * vanishes, and the turn waits forever. The panel's Skip used to send exactly
 * that.
 */

function controllerWithPendingAsk() {
  const messages: Array<Record<string, unknown>> = [];
  const controller = new GjcBunAskController({
    send: (message: unknown) => messages.push(message as Record<string, unknown>),
  } as never);
  const pending = controller.uiContext.select('Which parser?', ['PEG']);
  const requestId = messages.at(-1)?.requestId as string;
  assert.ok(requestId, 'the controller should have presented a request');
  return { controller, pending, requestId };
}

test('a chosen answer resolves the question with that answer', async () => {
  const { controller, pending, requestId } = controllerWithPendingAsk();

  const accepted = controller.resolve(requestId, {
    allow: true,
    updatedInput: { answers: { 'Which parser?': 'PEG' } },
  });

  assert.equal(accepted, true);
  assert.equal(await pending, 'PEG');
});

test('skipping resolves the question with no answer', async () => {
  const { controller, pending, requestId } = controllerWithPendingAsk();

  // The shape AskUserQuestionPanel's Skip sends.
  const accepted = controller.resolve(requestId, {
    allow: false,
    message: 'User skipped the question',
  });

  assert.equal(accepted, true, 'skip must consume the request');
  assert.equal(await pending, undefined);
});

test('an answerless allow is refused and leaves the question open', async () => {
  const { controller, pending, requestId } = controllerWithPendingAsk();

  assert.equal(controller.resolve(requestId, { allow: true }), false);
  assert.equal(controller.resolve(requestId, { allow: true, updatedInput: { answers: {} } }), false);

  // Still answerable, which is the point of refusing rather than resolving.
  assert.equal(
    controller.resolve(requestId, { allow: true, message: 'PEG' }),
    true,
  );
  assert.equal(await pending, 'PEG');
});

test('an unknown request id is not claimed', () => {
  const { controller } = controllerWithPendingAsk();

  // The adapter loops over runs until one claims the id, so false has to mean
  // "not mine" and nothing else.
  assert.equal(controller.resolve('sdk-ask:nope', { allow: false }), false);
});
