import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, render } from '@testing-library/react';

import {
  registerPaletteOps,
  resetPaletteOps,
  usePaletteOps,
  usePaletteOpsRegister,
} from './usePaletteOpsStore';

afterEach(() => {
  cleanup();
  resetPaletteOps();
});

test('ops captured before registration reach the op registered later', () => {
  const ops = usePaletteOps();
  const calls: string[] = [];

  // Unregistered: degrades to a no-op instead of throwing.
  ops.openSettings('tools');
  assert.equal(calls.length, 0);

  const unregister = registerPaletteOps({
    openSettings: (tab) => calls.push(`settings:${tab ?? 'default'}`),
  });
  ops.openSettings('appearance');
  assert.deepEqual(calls, ['settings:appearance']);

  unregister();
  ops.openSettings('tools');
  assert.deepEqual(calls, ['settings:appearance'], 'unregistered op degrades back to a no-op');
});

test('a later registration wins and unregistering restores the previous owner', () => {
  const calls: string[] = [];
  const ops = usePaletteOps();

  const first = registerPaletteOps({ startNewChat: () => calls.push('first') });
  const second = registerPaletteOps({ startNewChat: () => calls.push('second') });

  ops.startNewChat();
  assert.deepEqual(calls, ['second']);

  second();
  ops.startNewChat();
  assert.deepEqual(calls, ['second', 'first'], 'unregistering the winner restores the previous owner');

  // Unregistering the first (no longer current after restore? it is current again)
  first();
  ops.startNewChat();
  assert.deepEqual(calls, ['second', 'first'], 'no owner left means no-op');
});

test('unregistering a superseded owner does not clobber the current one', () => {
  const calls: string[] = [];
  const ops = usePaletteOps();

  const first = registerPaletteOps({ openCommandPalette: () => calls.push('first') });
  registerPaletteOps({ openCommandPalette: () => calls.push('second') });

  // First unmounts after being superseded: the current registration survives.
  first();
  ops.openCommandPalette();
  assert.deepEqual(calls, ['second']);
});

test('usePaletteOpsRegister registers on mount and restores on unmount', () => {
  const calls: string[] = [];
  const ops = usePaletteOps();

  function Owner() {
    usePaletteOpsRegister({ openFile: (path) => calls.push(`open:${path}`) });
    return null;
  }

  const view = render(<Owner />);
  ops.openFile('a.ts');
  assert.deepEqual(calls, ['open:a.ts']);

  view.unmount();
  ops.openFile('b.ts');
  assert.deepEqual(calls, ['open:a.ts'], 'unmounted owner degrades to a no-op');
});
