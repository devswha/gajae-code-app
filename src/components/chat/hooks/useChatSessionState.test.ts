import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRefreshCachedImageWindow } from './useChatSessionState';

test('re-enabling image previews refreshes only the already-cached session window', () => {
  // Same session, previews turned on, cache present: refresh in the background.
  assert.equal(shouldRefreshCachedImageWindow('s1:p1', false, 's1:p1', true, true), true);

  // A different session gets a fresh initial fetch instead.
  assert.equal(shouldRefreshCachedImageWindow('s1:p1', false, 's2:p1', true, true), false);

  // Previews unchanged or turned off: nothing to reconcile.
  assert.equal(shouldRefreshCachedImageWindow('s1:p1', true, 's1:p1', true, true), false);
  assert.equal(shouldRefreshCachedImageWindow('s1:p1', true, 's1:p1', false, true), false);

  // No cached window means the normal fetch path already applies the flag.
  assert.equal(shouldRefreshCachedImageWindow('s1:p1', false, 's1:p1', true, false), false);
});
