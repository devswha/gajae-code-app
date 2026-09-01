import assert from 'node:assert/strict';
import test from 'node:test';

import { sliceTailPage } from '@/shared/utils.js';

const chronology = ['a', 'b', 'c', 'd', 'e'];

test('tail paging begins with the newest entries and moves toward the start', () => {
  const newest = sliceTailPage(chronology, 2, 0);
  const previous = sliceTailPage(chronology, 2, 2);
  const first = sliceTailPage(chronology, 2, 4);

  assert.deepEqual(newest, { page: ['d', 'e'], hasMore: true });
  assert.deepEqual(previous, { page: ['b', 'c'], hasMore: true });
  assert.deepEqual(first, { page: ['a'], hasMore: false });
});

test('tail paging supports an unbounded request and exhausted offsets', () => {
  assert.deepEqual(sliceTailPage(chronology, null, 0), {
    page: chronology,
    hasMore: false,
  });
  assert.deepEqual(sliceTailPage(chronology, 3, 10), {
    page: [],
    hasMore: false,
  });
});

test('an empty page size retains whether older data exists', () => {
  assert.deepEqual(sliceTailPage(chronology, 0, 0), {
    page: [],
    hasMore: true,
  });
});
