import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { cleanup, render, screen } from '@testing-library/react';

import { Dialog, DialogContent, DialogTitle } from './Dialog';

/*
 * Tailwind 4 centers the panel with the `translate` property, not
 * `transform`. An entrance keyframe that translates - in either property -
 * composes with the centering, so the panel opens offset toward the upper
 * left and snaps to center when the animation ends. Three dialogs had
 * papered over that with `animate-none` before the keyframe was fixed; this
 * pins the contract at the primitive so no dialog needs to opt out again.
 */

afterEach(cleanup);

const stylesheet = readFileSync(path.resolve(import.meta.dirname, '../../../index.css'), 'utf8');

const keyframeBlock = (name: string): string => {
  const start = stylesheet.indexOf(`@keyframes ${name}`);
  assert.notEqual(start, -1, `${name} is defined in src/index.css`);
  let depth = 0;
  for (let index = stylesheet.indexOf('{', start); index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}') {
      depth -= 1;
      if (depth === 0) return stylesheet.slice(start, index + 1);
    }
  }
  throw new Error(`${name} block is not closed`);
};

test('the panel is centered by the translate utilities and animated by the keyframe alone', () => {
  render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogTitle>Centered</DialogTitle>
        body
      </DialogContent>
    </Dialog>
  );
  const panel = screen.getByRole('dialog');
  const classes = panel.className.split(/\s+/);
  for (const expected of ['fixed', 'top-1/2', 'left-1/2', '-translate-x-1/2', '-translate-y-1/2', 'animate-dialog-content-show']) {
    assert.ok(classes.includes(expected), `${expected} on the panel`);
  }
  assert.ok(!classes.includes('animate-none'), 'the primitive does not opt out of its own entrance');
});

test('the entrance keyframe never translates, so it cannot fight the centering', () => {
  const block = keyframeBlock('dialog-content-show');
  assert.doesNotMatch(block, /translate/, 'no translate() or translate: in dialog-content-show');
  assert.match(block, /transform:\s*scale\(/, 'the entrance is a scale');
  assert.match(block, /opacity:\s*0/, 'the entrance fades in');
});

test('no dialog opts out of the entrance with animate-none', () => {
  const src = path.resolve(import.meta.dirname, '../../..');
  const offenders = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx?|jsx?|css)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => file !== import.meta.filename && readFileSync(file, 'utf8').includes('animate-none'))
    .map((file) => path.relative(src, file));
  assert.deepEqual(offenders, [], 'animate-none is a band-aid over the primitive; fix the keyframe instead');
});
