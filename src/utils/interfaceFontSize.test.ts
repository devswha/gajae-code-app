import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyInterfaceFontSize,
  INTERFACE_FONT_SIZE_PIXELS,
  INTERFACE_FONT_SIZE_SCALES,
  normalizeInterfaceFontSize,
  readInterfaceFontSize,
} from './interfaceFontSize';

test('normalizes interface font sizes and defaults invalid values to medium', () => {
  assert.equal(normalizeInterfaceFontSize('small'), 'small');
  assert.equal(normalizeInterfaceFontSize('large'), 'large');
  assert.equal(normalizeInterfaceFontSize('unexpected'), 'medium');
  assert.equal(normalizeInterfaceFontSize(null), 'medium');
});

test('reads and applies the persisted interface font size', () => {
  assert.equal(readInterfaceFontSize({ getItem: () => 'large' }), 'large');

  const customProperties = new Map<string, string>();
  const root = {
    dataset: {},
    style: {
      setProperty: (name: string, value: string) => customProperties.set(name, value),
    },
  } as unknown as HTMLElement;
  applyInterfaceFontSize('small', root);

  assert.equal(root.dataset.interfaceFontSize, 'small');
  assert.equal(root.style.fontSize, `${INTERFACE_FONT_SIZE_PIXELS.small}px`);
  assert.equal(customProperties.get('--interface-font-scale'), String(INTERFACE_FONT_SIZE_SCALES.small));
});
