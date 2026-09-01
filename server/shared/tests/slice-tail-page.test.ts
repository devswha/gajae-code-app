import { strict as check } from 'node:assert';
import { test as specification } from 'node:test';

import { sliceTailPage as pageFromNewest } from '@/shared/utils.js';

const sessionTimeline = ['session-bootstrap', 'session-import', 'session-review', 'session-fix', 'session-release'];

specification('tail pages return the requested newest window and indicate earlier records', () => {
  const pageRequests = [
    { offset: 0, expected: { page: ['session-fix', 'session-release'], hasMore: true } },
    { offset: 2, expected: { page: ['session-import', 'session-review'], hasMore: true } },
    { offset: 4, expected: { page: ['session-bootstrap'], hasMore: false } },
  ];

  for (const { offset, expected } of pageRequests) {
    check.deepEqual(pageFromNewest(sessionTimeline, 2, offset), expected);
  }
});

specification('unbounded and exhausted requests produce their complete available result', () => {
  check.deepEqual(pageFromNewest(sessionTimeline, null, 0), {
    page: sessionTimeline,
    hasMore: false,
  });
  check.deepEqual(pageFromNewest(sessionTimeline, 3, 10), {
    page: [],
    hasMore: false,
  });
});

specification('a zero-sized window still reports whether historical records remain', () => {
  check.deepEqual(pageFromNewest(sessionTimeline, 0, 0), {
    page: [],
    hasMore: true,
  });
});
