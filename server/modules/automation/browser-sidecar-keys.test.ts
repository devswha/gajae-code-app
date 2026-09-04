import assert from 'node:assert/strict';
import test from 'node:test';

import { toPuppeteerKeyInput } from './browser-sidecar.js';

test('maps editing and navigation keys to Puppeteer key inputs', () => {
  for (const key of [
    'Backspace', 'Delete', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Enter', 'Escape', 'Shift',
    'Control', 'Alt', 'Meta',
  ]) {
    assert.equal(toPuppeteerKeyInput(key), key);
  }
});

test('maps DOM key aliases and printable characters to Puppeteer key inputs', () => {
  assert.equal(toPuppeteerKeyInput('OS'), 'Meta');
  assert.equal(toPuppeteerKeyInput('Esc'), 'Escape');
  assert.equal(toPuppeteerKeyInput(' '), 'Space');
  assert.equal(toPuppeteerKeyInput('a'), 'a');
  assert.equal(toPuppeteerKeyInput('7'), '7');
});

test('maps function keys and rejects IME keys', () => {
  for (let index = 1; index <= 12; index += 1) {
    assert.equal(toPuppeteerKeyInput(`F${index}`), `F${index}`);
  }
  for (const key of ['Dead', 'Unidentified', 'Process']) {
    assert.equal(toPuppeteerKeyInput(key), null);
  }
});
