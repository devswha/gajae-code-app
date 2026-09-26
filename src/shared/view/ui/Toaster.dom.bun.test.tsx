import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import '../../../i18n/config';
import { TOAST_DURATION_MS, resetToasts, showErrorToast, showToast } from '../../../stores/useToastStore';

import { Toaster } from './Toaster';

const realSetTimeout = window.setTimeout;
const realClearTimeout = window.clearTimeout;
const realDateNow = Date.now;
let timers: Map<number, { run: () => void; at: number }>;
let now = 0;
let nextTimer = 1;

beforeEach(() => {
  resetToasts();
  timers = new Map();
  now = 0;
  window.setTimeout = ((run: () => void, ms = 0) => {
    const id = nextTimer++;
    timers.set(id, { run, at: now + ms });
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof window.clearTimeout;
  Date.now = () => now;
});

afterEach(() => {
  cleanup();
  resetToasts();
  window.setTimeout = realSetTimeout;
  window.clearTimeout = realClearTimeout;
  Date.now = realDateNow;
});

const advance = (ms: number) => act(() => {
  now += ms;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) {
      timers.delete(id);
      timer.run();
    }
  }
});

test('an error is announced as an alert and dismissed by its close button', () => {
  render(<Toaster />);
  act(() => showErrorToast('Could not rename the conversation.'));

  const alert = screen.getByRole('alert');
  assert.equal(alert.textContent?.includes('Could not rename the conversation.'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  assert.equal(screen.queryByRole('alert'), null);
});

test('a notice goes away on its own, but not while the pointer holds it', () => {
  render(<Toaster />);
  act(() => showToast('Copied.'));
  const notice = screen.getByRole('status');

  fireEvent.pointerEnter(notice);
  advance(TOAST_DURATION_MS.info * 2);
  assert.ok(screen.getByRole('status'), 'a held notice stays');

  fireEvent.pointerLeave(notice);
  advance(TOAST_DURATION_MS.info);
  assert.equal(screen.queryByRole('status'), null);
});

test('the same message is not stacked twice, and at most three show', () => {
  render(<Toaster />);
  act(() => {
    showErrorToast('Same failure');
    showErrorToast('Same failure');
  });
  assert.equal(screen.getAllByRole('alert').length, 1);

  act(() => ['a', 'b', 'c', 'd'].forEach((message) => showErrorToast(message)));
  const messages = screen.getAllByRole('alert').map((node) => node.textContent);
  assert.deepEqual(messages, ['b', 'c', 'd'], 'the oldest gives way');
});
