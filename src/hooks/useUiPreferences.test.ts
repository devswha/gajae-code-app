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

test('the stamp is written at load, beside the value the migration produced', () => {
  // The stamp used to ride along with the ordinary save effect, which runs for
  // state a component already holds. A hot module replacement swaps this file
  // under mounted hooks without re-running their initializer, so the new stamp
  // landed next to a value that had never been migrated - and every later load
  // skipped the migration it was owed. Reported in the wild as thinking rows
  // that survived both the new default and a reload.
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true }));

  const preferences = readInitialPreferencesForTest(STORAGE_KEY);

  assert.equal(preferences.showThinking, false);
  assert.equal(store.get(`${STORAGE_KEY}.version`), String(UI_PREFERENCES_VERSION));
});

test('a second instance mounting later sees the migrated value, not the stale one', () => {
  // The hook has several call sites and they do not mount in one commit. When
  // the stamp was written on its own, the instance that mounted second read
  // the still-unmigrated state, decided the migration was already done, and
  // then persisted that stale value back over the migrated one.
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true }));

  const first = readInitialPreferencesForTest(STORAGE_KEY);
  const second = readInitialPreferencesForTest(STORAGE_KEY);

  assert.equal(first.showThinking, false);
  assert.equal(second.showThinking, false);
  assert.equal(JSON.parse(store.get(STORAGE_KEY)!).showThinking, false);
});

test('a profile stamped by that bug is corrected once', () => {
  // Exactly the reported state: the old stamp sits beside an unmigrated true.
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true }));
  store.set(`${STORAGE_KEY}.version`, '1');

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).showThinking, false);
  assert.equal(store.get(`${STORAGE_KEY}.version`), String(UI_PREFERENCES_VERSION));
});

/*
 * Version 3 replaces the two display switches with one density level. Someone
 * who had turned either switch on was asking to see more than the default, so
 * they land on `detailed`; everyone else keeps the balanced default. Neither
 * old key is dropped: a downgrade still finds them.
 */

test('a fresh profile starts balanced', () => {
  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'balanced');
});

test('a profile that chose to see reasoning becomes detailed', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true, showRawParameters: false }));
  store.set(`${STORAGE_KEY}.version`, '2');

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'detailed');
});

test('a profile that chose to see raw parameters becomes detailed, and the choice is kept', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: false, showRawParameters: true }));
  store.set(`${STORAGE_KEY}.version`, '2');

  const preferences = readInitialPreferencesForTest(STORAGE_KEY);

  assert.equal(preferences.toolOutputDensity, 'detailed');
  assert.equal(preferences.showRawParameters, true);
  assert.equal(JSON.parse(store.get(STORAGE_KEY)!).showRawParameters, true);
});

test('a profile with both switches off becomes balanced', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: false, showRawParameters: false }));
  store.set(`${STORAGE_KEY}.version`, '2');

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'balanced');
});

test('an unstamped profile whose thinking flag was only the old default does not become detailed', () => {
  // The version-2 reset runs first, so the stale default is not read as a wish
  // for more detail. Raw parameters were never defaulted on, so that one counts.
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true }));
  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'balanced');

  store.clear();
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true, showRawParameters: true }));
  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'detailed');
});

test('a level chosen after the migration is never re-derived from the old switches', () => {
  store.set(STORAGE_KEY, JSON.stringify({ showThinking: true, showRawParameters: true, toolOutputDensity: 'compact' }));
  store.set(`${STORAGE_KEY}.version`, String(UI_PREFERENCES_VERSION));

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'compact');
});

test('a level that is not one of the three reads as the default', () => {
  store.set(STORAGE_KEY, JSON.stringify({ toolOutputDensity: 'verbose' }));
  store.set(`${STORAGE_KEY}.version`, String(UI_PREFERENCES_VERSION));

  assert.equal(readInitialPreferencesForTest(STORAGE_KEY).toolOutputDensity, 'balanced');
});
