import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserFramePoint,
  MAX_BROWSER_VIEWPORT,
  MIN_BROWSER_VIEWPORT,
  normalizeBrowserViewport,
} from '../../../../shared/browserViewport';

test('browser viewport sizes round and stay inside the supported bounds', () => {
  assert.deepEqual(normalizeBrowserViewport(517.6, 742.2), { width: 518, height: 742 });
  assert.deepEqual(normalizeBrowserViewport(1, 10_000), {
    width: MIN_BROWSER_VIEWPORT.width,
    height: MAX_BROWSER_VIEWPORT.height,
  });
  assert.equal(normalizeBrowserViewport(Number.NaN, 800), null);
  assert.equal(normalizeBrowserViewport(800, 0), null);
});

test('browser frame coordinates account for object-contain letterboxing and frame scaling', () => {
  assert.deepEqual(browserFramePoint({
    clientX: 500,
    clientY: 300,
    boundsLeft: 100,
    boundsTop: 100,
    boundsWidth: 800,
    boundsHeight: 400,
    frameWidth: 400,
    frameHeight: 400,
    viewportWidth: 800,
    viewportHeight: 800,
  }), { x: 400, y: 400 });

  assert.equal(browserFramePoint({
    clientX: 200,
    clientY: 300,
    boundsLeft: 100,
    boundsTop: 100,
    boundsWidth: 800,
    boundsHeight: 400,
    frameWidth: 400,
    frameHeight: 400,
    viewportWidth: 800,
    viewportHeight: 800,
  }), null);
});
