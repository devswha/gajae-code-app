import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { ThemeProvider, useTheme } from '../../../contexts/ThemeContext';
import english from '../../../i18n/locales/en/settings.json';

import ThemePicker from './ThemePicker';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { settings: english } } });

/** A controllable `prefers-color-scheme: dark` query standing in for the OS setting. */
function fakeSystemAppearance(initiallyDark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: initiallyDark,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  };
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  return (dark: boolean) => act(() => {
    query.matches = dark;
    for (const listener of listeners) listener({ matches: dark });
  });
}

const originalMatchMedia = window.matchMedia;

function Toggle() {
  const { toggleDarkMode } = useTheme();
  return <button onClick={toggleDarkMode}>Toggle theme</button>;
}

function mount() {
  render(<I18nextProvider i18n={i18n}><ThemeProvider><ThemePicker /><Toggle /></ThemeProvider></I18nextProvider>);
}

const isDark = () => document.documentElement.classList.contains('dark');
const checked = () => screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true').map((radio) => radio.textContent);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = originalMatchMedia;
  document.documentElement.classList.remove('dark');
});

test('with no choice made, the app follows the system appearance live and stores nothing', () => {
  const setSystemDark = fakeSystemAppearance(true);
  mount();
  assert.deepEqual(checked(), ['System']);
  assert.equal(isDark(), true);

  setSystemDark(false);
  assert.equal(isDark(), false);
  setSystemDark(true);
  assert.equal(isDark(), true);
  assert.equal(localStorage.getItem('theme'), null, 'a derived theme must never be persisted as a choice');
});

test('choosing Light pins it against the system; choosing System again follows the system', () => {
  const setSystemDark = fakeSystemAppearance(true);
  mount();

  fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
  assert.equal(isDark(), false);
  assert.equal(localStorage.getItem('theme'), 'light');
  setSystemDark(true);
  assert.equal(isDark(), false, 'an explicit choice ignores the system');

  fireEvent.click(screen.getByRole('radio', { name: 'System' }));
  assert.equal(localStorage.getItem('theme'), null);
  assert.equal(isDark(), true);
});

test('a stored choice is restored on launch', () => {
  fakeSystemAppearance(false);
  localStorage.setItem('theme', 'dark');
  mount();
  assert.deepEqual(checked(), ['Dark']);
  assert.equal(isDark(), true);
});

test('the quick toggle from System pins the opposite of what is on screen', () => {
  fakeSystemAppearance(true);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
  assert.deepEqual(checked(), ['Light']);
  assert.equal(localStorage.getItem('theme'), 'light');
  assert.equal(isDark(), false);
});

test('the page states its background as theme-color, which the desktop title bar follows', () => {
  fakeSystemAppearance(false);
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  mount();
  const meta = () => document.head.querySelectorAll('meta[name="theme-color"]');
  assert.equal(meta().length, 1, 'the provider creates the tag when the page has none');
  const light = meta()[0].getAttribute('content');

  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  assert.equal(meta().length, 1);
  assert.notEqual(meta()[0].getAttribute('content'), light, 'the colour follows the theme');
});
