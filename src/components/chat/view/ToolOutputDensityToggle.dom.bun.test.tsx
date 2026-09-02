import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import '../../../i18n/config';
import { readInitialPreferencesForTest } from '../../../hooks/useUiPreferences';

import ToolOutputDensityPicker from './ToolOutputDensityPicker';
import ToolOutputDensityToggle from './ToolOutputDensityToggle';

/*
 * The quick toggle is a button and a keyboard chord, and both go through the
 * preference hook's reducer and its persistence effect - nothing a static
 * render can reach. This mounts the real thing and watches the stored value.
 */

const STORAGE_KEY = 'uiPreferences';
const storedDensity = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').toolOutputDensity;
const chord = (overrides: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document, { key: 'D', metaKey: true, shiftKey: true, ...overrides });

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

test('clicking walks compact -> balanced -> detailed -> compact and persists each step', () => {
  render(createElement(ToolOutputDensityToggle));
  const button = screen.getByRole('button');

  assert.equal(button.getAttribute('data-density'), 'balanced');

  fireEvent.click(button);
  assert.equal(button.getAttribute('data-density'), 'detailed');
  assert.equal(storedDensity(), 'detailed');

  fireEvent.click(button);
  assert.equal(button.getAttribute('data-density'), 'compact');
  assert.equal(storedDensity(), 'compact');

  fireEvent.click(button);
  assert.equal(button.getAttribute('data-density'), 'balanced');
  assert.equal(storedDensity(), 'balanced');
});

test('the label names the current level and the chord that changes it', () => {
  render(createElement(ToolOutputDensityToggle));
  const button = screen.getByRole('button');

  assert.match(button.getAttribute('aria-label') ?? '', /Tool output: Balanced \((⌘⇧D|Ctrl\+Shift\+D)\)/);

  fireEvent.click(button);
  assert.match(button.getAttribute('aria-label') ?? '', /Tool output: Detailed/);
});

test('Cmd/Ctrl+Shift+D cycles the level from anywhere while the header is mounted', () => {
  render(createElement(ToolOutputDensityToggle));
  const button = screen.getByRole('button');

  act(() => { chord(); });
  assert.equal(button.getAttribute('data-density'), 'detailed');

  act(() => { chord({ metaKey: false, ctrlKey: true }); });
  assert.equal(button.getAttribute('data-density'), 'compact');
  assert.equal(storedDensity(), 'compact');
});

test('a held key and a plain Cmd+D leave the level alone', () => {
  render(createElement(ToolOutputDensityToggle));
  const button = screen.getByRole('button');

  act(() => { chord({ repeat: true }); });
  act(() => { fireEvent.keyDown(document, { key: 'd', metaKey: true }); });
  act(() => { fireEvent.keyDown(document, { key: 'd', shiftKey: true }); });

  assert.equal(button.getAttribute('data-density'), 'balanced');
});

test('the chord is released with the toggle', () => {
  const { unmount } = render(createElement(ToolOutputDensityToggle));
  unmount();

  act(() => { chord(); });

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'balanced');
});

test('the settings picker is a radio group that reports the chosen level', () => {
  const chosen: string[] = [];
  render(createElement(ToolOutputDensityPicker, {
    value: 'balanced',
    onChange: (level) => chosen.push(level),
    ariaLabel: 'Tool output density',
  }));

  const group = screen.getByRole('radiogroup', { name: 'Tool output density' });
  const radios = screen.getAllByRole('radio');
  assert.equal(radios.length, 3);
  assert.deepEqual(radios.map((radio) => radio.getAttribute('aria-checked')), ['false', 'true', 'false']);
  assert.ok(group.contains(radios[0]));

  fireEvent.click(screen.getByRole('radio', { name: 'Detailed' }));
  assert.deepEqual(chosen, ['detailed']);
});
