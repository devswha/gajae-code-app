import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

/**
 * Preferences are written to storage in full on first mount, so every profile
 * ends up with an explicit copy of whatever the defaults were that day. A
 * stored value therefore says nothing about whether anyone chose it, and a
 * changed default would otherwise only ever reach brand-new installs.
 *
 * The version stamp is what makes the correction safe: it applies once, and a
 * choice made after that is never touched again.
 */

const STORAGE_KEY = 'uiPreferences';
const store = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  },
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });

const { UI_PREFERENCES_VERSION, readInitialPreferencesForTest } = await import('./useUiPreferences.js');

afterEach(() => store.clear());

test('a profile written under the old default has thinking turned off once', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true, showImagePreviews: true }));
  // No version stamp: this profile predates the change.

  const preferences = readInitialPreferencesForTest(STORAGE_KEY);

  assert.equal(preferences.showThinking, false);
  // Unrelated preferences survive the migration untouched.
  assert.equal(preferences.showImagePreviews, true);
});

test('turning it back on after the migration sticks', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true }));
  store.set(`${STORAGE_KEY}.version`, String(UI_PREFERENCES_VERSION));

  const preferences = readInitialPreferencesForTest(STORAGE_KEY);

  assert.equal(preferences.showThinking, true);
});

test('a future stamp is never rolled back', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true }));
  store.set(`${STORAGE_KEY}.version`, String(UI_PREFERENCES_VERSION + 5));

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).showThinking, true);
});

test('an unstamped profile that already had it off stays off', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: false }));

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).showThinking, false);
});

test('a fresh profile takes the current default', () => {
  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).showThinking, false);
});
