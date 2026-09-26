import assert from 'node:assert/strict';
import test from 'node:test';

import { composeWindowTitle } from './windowTitle';

test('the title leads with the count the Dock badge reads, then the place', () => {
  assert.equal(composeWindowTitle({ attention: 2, place: 'Fix the flaky test' }), '(2) Fix the flaky test — Gajae Code App');
  assert.equal(composeWindowTitle({ attention: 0, place: 'tidepool' }), 'tidepool — Gajae Code App');
  assert.equal(composeWindowTitle({ attention: 0 }), 'Gajae Code App');
});

test('no count for nothing, and never a malformed one', () => {
  assert.equal(composeWindowTitle({ attention: -1, place: ' ' }), 'Gajae Code App');
  assert.equal(composeWindowTitle({ attention: 1.5 }), 'Gajae Code App');
});
