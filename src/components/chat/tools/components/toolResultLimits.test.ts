import assert from 'node:assert/strict';
import test from 'node:test';

import { readToolResultLimits } from './ToolResultLimits';

/*
 * A tool that stops at a cap returns less than it found, and says so only in
 * the structured `meta.limits` the runtime attaches to its result. None of it
 * reaches the text the model sees, so before the details rail existed a
 * truncated search rendered as a complete one with nothing to contradict it.
 *
 * This reads that record defensively: it runs on every tool result, including
 * ones from other providers that never carry the shape at all.
 */

const withLimits = (limits: unknown) => ({ toolUseResult: { meta: { limits } } });

test('a match cap is reported with the count and the wider limit that would help', () => {
  const limits = readToolResultLimits(withLimits({ matchLimit: { reached: 50, suggestion: 200 } }));

  assert.deepEqual(limits?.matchLimit, { reached: 50, suggestion: 200 });
});

test('result and head caps are read the same way', () => {
  assert.deepEqual(
    readToolResultLimits(withLimits({ resultLimit: { reached: 20, suggestion: 100 } }))?.resultLimit,
    { reached: 20, suggestion: 100 },
  );
  assert.deepEqual(
    readToolResultLimits(withLimits({ headLimit: { reached: 10, suggestion: 50 } }))?.headLimit,
    { reached: 10, suggestion: 50 },
  );
});

test('a column truncation is reported even with no count cap', () => {
  const limits = readToolResultLimits(withLimits({ columnTruncated: { maxColumn: 200 } }));

  assert.deepEqual(limits?.columnTruncated, { maxColumn: 200 });
});

test('a result that hit no cap reports nothing', () => {
  // The row must stay absent rather than render an empty warning.
  assert.equal(readToolResultLimits({ toolUseResult: { meta: {} } }), undefined);
  assert.equal(readToolResultLimits({ toolUseResult: { meta: { limits: {} } } }), undefined);
  assert.equal(readToolResultLimits({ toolUseResult: {} }), undefined);
});

test('a result carrying no details at all reports nothing', () => {
  // Every other provider's results land here too, and none of them carry the
  // runtime's meta shape.
  assert.equal(readToolResultLimits({ content: 'plain', isError: false }), undefined);
  assert.equal(readToolResultLimits(undefined), undefined);
  assert.equal(readToolResultLimits(null), undefined);
  assert.equal(readToolResultLimits('a string'), undefined);
});

test('a malformed cap is ignored rather than rendered as a confident sentence', () => {
  // Zero reached means nothing was cut, and a non-numeric cap is not a cap.
  // Either would produce a sentence stating a number that means nothing.
  assert.equal(readToolResultLimits(withLimits({ matchLimit: { reached: 0, suggestion: 200 } })), undefined);
  assert.equal(readToolResultLimits(withLimits({ matchLimit: { reached: '50', suggestion: 200 } })), undefined);
  assert.equal(readToolResultLimits(withLimits({ matchLimit: { reached: 50 } })), undefined);
  assert.equal(readToolResultLimits(withLimits({ matchLimit: 'yes' })), undefined);
  assert.equal(readToolResultLimits(withLimits({ columnTruncated: { maxColumn: 0 } })), undefined);
});

test('a hostile details shape never throws', () => {
  for (const shape of [
    { toolUseResult: 'string' },
    { toolUseResult: { meta: 'string' } },
    { toolUseResult: { meta: { limits: 42 } } },
    { toolUseResult: { meta: { limits: null } } },
  ]) {
    assert.doesNotThrow(() => readToolResultLimits(shape));
    assert.equal(readToolResultLimits(shape), undefined);
  }
});
