import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { modShortcutLabel } from './shortcutLabel';

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

const onPlatform = (platform: string) => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform, userAgent: '' } });
};

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
  else Reflect.deleteProperty(globalThis, 'navigator');
});

test('a Mac shows the command-key glyphs', () => {
  onPlatform('MacIntel');
  assert.equal(modShortcutLabel('K'), '⌘K');
  assert.equal(modShortcutLabel('D', { shift: true }), '⌘⇧D');
});

test('other platforms spell the chord out', () => {
  onPlatform('Win32');
  assert.equal(modShortcutLabel('K'), 'Ctrl+K');
  assert.equal(modShortcutLabel('P', { shift: true }), 'Ctrl+Shift+P');
});
