/**
 * A tooltip anchored near a viewport edge used to centre itself half off
 * screen, which is where the sidebar's first quota indicator puts it. The
 * clamp keeps the box on screen without moving it when it already fits.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { clampTooltipCentre } from './Tooltip';

test('a box that already fits is not moved', () => {
  assert.equal(clampTooltipCentre(640, 160, 1280), 640);
});

test('an anchor near the left edge is pushed in far enough to stay readable', () => {
  // 160px box centred on 29px would start at -51px.
  assert.equal(clampTooltipCentre(29, 160, 1280), 88);
});

test('an anchor near the right edge is pushed in by the same margin', () => {
  assert.equal(clampTooltipCentre(1270, 160, 1280), 1192);
});

test('a box wider than the viewport is centred rather than pinned to one edge', () => {
  assert.equal(clampTooltipCentre(29, 1400, 1280), 640);
});

test('the clamp is symmetric about the viewport centre', () => {
  const viewport = 1000;
  assert.equal(clampTooltipCentre(0, 200, viewport), viewport - clampTooltipCentre(viewport, 200, viewport));
});
