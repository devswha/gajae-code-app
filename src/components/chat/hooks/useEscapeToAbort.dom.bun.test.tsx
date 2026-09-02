import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { useEscapeToAbort } from './useEscapeToAbort';

afterEach(cleanup);

function Probe({ canAbort, onAbort }: { canAbort: boolean; onAbort: () => void }) {
  useEscapeToAbort(canAbort, onAbort);
  return createElement('textarea');
}

test('Escape aborts a stoppable run and is ignored once the run ends', () => {
  const aborted: number[] = [];
  const view = render(createElement(Probe, { canAbort: true, onAbort: () => aborted.push(1) }));

  fireEvent.keyDown(document, { key: 'Escape' });
  assert.deepEqual(aborted, [1]);

  fireEvent.keyDown(document, { key: 'Escape', repeat: true });
  assert.deepEqual(aborted, [1]);

  view.rerender(createElement(Probe, { canAbort: false, onAbort: () => aborted.push(1) }));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.deepEqual(aborted, [1]);
});
