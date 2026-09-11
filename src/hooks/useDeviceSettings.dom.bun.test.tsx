import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { focusSearchInputSafely, isTouchOrMobileDevice } from './useDeviceSettings';

let originalInnerWidth: number;
let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  originalInnerWidth = window.innerWidth;
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  window.innerWidth = originalInnerWidth;
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = '';
});

test('isTouchOrMobileDevice returns true when viewport is narrow', () => {
  window.innerWidth = 390;
  window.matchMedia = () => ({ matches: false } as MediaQueryList);
  assert.equal(isTouchOrMobileDevice(), true);
});

test('isTouchOrMobileDevice returns true when pointer is coarse', () => {
  window.innerWidth = 1024;
  window.matchMedia = (query) => ({ matches: query === '(pointer: coarse)' } as MediaQueryList);
  assert.equal(isTouchOrMobileDevice(), true);
});

test('isTouchOrMobileDevice returns false on desktop with fine pointer', () => {
  window.innerWidth = 1024;
  window.matchMedia = () => ({ matches: false } as MediaQueryList);
  assert.equal(isTouchOrMobileDevice(), false);
});

test('focusSearchInputSafely does not focus input and blurs active element on mobile', () => {
  window.innerWidth = 390;
  window.matchMedia = () => ({ matches: false } as MediaQueryList);

  const textarea = document.createElement('textarea');
  const searchInput = document.createElement('input');
  document.body.appendChild(textarea);
  document.body.appendChild(searchInput);

  textarea.focus();
  assert.equal(document.activeElement === textarea, true);

  focusSearchInputSafely(searchInput);

  assert.equal(document.activeElement === searchInput, false);
  assert.equal(document.activeElement === textarea, false);
});

test('focusSearchInputSafely focuses input on desktop', async () => {
  window.innerWidth = 1024;
  window.matchMedia = () => ({ matches: false } as MediaQueryList);

  const searchInput = document.createElement('input');
  document.body.appendChild(searchInput);

  focusSearchInputSafely(searchInput);

  await new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      assert.equal(document.activeElement === searchInput, true);
      resolve(undefined);
    });
  });
});
