import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ContextUsageRing from './ContextUsageRing';

const render = (sessionState: Record<string, unknown> | null) =>
  renderToStaticMarkup(createElement(ContextUsageRing, { sessionState }));

const arcLength = (html: string) => {
  const dash = /stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(html);
  return dash ? { arc: Number(dash[1]), circumference: Number(dash[2]) } : null;
};

test('a session that never reported a window renders nothing', () => {
  assert.equal(render(null), '');
  assert.equal(render({ contextPercent: 40 }), '', 'a percentage without a window is not a gauge');
  assert.equal(render({ contextWindow: 200_000 }), '', 'a window without a percentage is not a gauge');
});

test('the arc covers the reported share of the window', () => {
  const html = render({ contextPercent: 25, contextWindow: 200_000, contextTokens: 50_000 });
  const dash = arcLength(html);
  assert.ok(dash, 'the ring must draw an arc');
  assert.ok(Math.abs(dash.arc / dash.circumference - 0.25) < 0.001);
  assert.match(html, /data-context-percent="25"/);
});

test('an empty context draws the track alone so a fresh session shows no dot', () => {
  const html = render({ contextPercent: 0, contextWindow: 200_000, contextTokens: 0 });
  assert.equal(arcLength(html), null);
  assert.match(html, /stroke-border/);
});

test('the arc warms as the window fills and is clamped at full', () => {
  assert.match(render({ contextPercent: 42, contextWindow: 1000 }), /stroke-foreground\/70/);
  assert.match(render({ contextPercent: 75, contextWindow: 1000 }), /stroke-primary/);
  assert.match(render({ contextPercent: 93, contextWindow: 1000 }), /stroke-destructive/);

  const over = render({ contextPercent: 140, contextWindow: 1000 });
  const dash = arcLength(over);
  assert.ok(dash && Math.abs(dash.arc - dash.circumference) < 0.001, 'the arc cannot exceed the ring');
  assert.match(over, /data-context-percent="100"/);
});

test('the exact numbers stay on the control instead of on the toolbar', () => {
  const html = render({ contextPercent: 42, contextWindow: 128_000, contextTokens: 53_760 });
  assert.match(html, /aria-label="workspace\.statusTab\.context 42%"/);
  assert.match(html, /title="[^"]*53,760 \/ 128,000 workspace\.statustab\.tokens"/);
  assert.doesNotMatch(html, />42%</, 'the ring is the readout; no percent text belongs in the row');

  const withoutUsage = /title="([^"]*)"/.exec(render({ contextPercent: 42, contextWindow: 128_000 }))?.[1];
  assert.ok(withoutUsage, 'the ring must keep a hover readout');
  assert.match(withoutUsage, /128,000 workspace\.statustab\.tokens$/);
  assert.doesNotMatch(withoutUsage, /\//, 'an unknown used-token count must not print a fake ratio');
});
