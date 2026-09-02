import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';

import { STEADY_LABEL_MS, useSteadyLabel } from './useSteadyLabel';

afterEach(cleanup);

function Probe({ label }: { label: string }) {
  return createElement('span', { 'data-testid': 'label' }, useSteadyLabel(label));
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

test('a label that just appeared keeps its place until it has been readable, then the newest one takes over', async () => {
  const view = render(createElement(Probe, { label: 'Thinking' }));
  const shown = () => view.getByTestId('label').textContent;

  // A phase that lasts a few frames: requested, withdrawn before the hold is up.
  view.rerender(createElement(Probe, { label: 'Retrying (attempt 1)' }));
  assert.equal(shown(), 'Thinking');
  await wait(50);
  view.rerender(createElement(Probe, { label: 'Thinking' }));
  await wait(STEADY_LABEL_MS + 50);
  assert.equal(shown(), 'Thinking', 'the withdrawn phase never flashed');

  // A change that arrives once the current label has been up long enough shows at once.
  view.rerender(createElement(Probe, { label: 'Reading src/a.ts' }));
  assert.equal(shown(), 'Reading src/a.ts');

  // A burst settles on the last label, after the hold.
  view.rerender(createElement(Probe, { label: 'Running npm test' }));
  view.rerender(createElement(Probe, { label: 'Editing src/a.ts' }));
  assert.equal(shown(), 'Reading src/a.ts');
  await wait(STEADY_LABEL_MS + 50);
  assert.equal(shown(), 'Editing src/a.ts');
});
