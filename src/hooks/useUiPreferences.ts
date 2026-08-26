import { useEffect, useReducer, useRef } from 'react';

type UiPreferences = {
  showRawParameters: boolean;
  showThinking: boolean;
  showImagePreviews: boolean;
  sendByCtrlEnter: boolean;
  sidebarVisible: boolean;
  voiceEnabled: boolean;
};

type UiPreferenceKey = keyof UiPreferences;

type SetPreferenceAction = {
  type: 'set';
  key: UiPreferenceKey;
  value: unknown;
};

type SetManyPreferencesAction = {
  type: 'set_many';
  value?: Partial<Record<UiPreferenceKey, unknown>>;
};

type ResetPreferencesAction = {
  type: 'reset';
  value?: Partial<UiPreferences>;
};

type UiPreferencesAction =
  | SetPreferenceAction
  | SetManyPreferencesAction
  | ResetPreferencesAction;

const DEFAULTS: UiPreferences = {
  showRawParameters: false,
  // Off by default: a replayed transcript carries no thinking duration, so the
  // collapsed row reads "Thought for a few seconds" on every entry regardless
  // of what happened, and the reasoning itself is already behind a click.
  // Settings → Appearance turns it back on for anyone who wants it.
  showThinking: false,
  showImagePreviews: true,
  sendByCtrlEnter: false,
  sidebarVisible: true,
  voiceEnabled: false,
};

const PREFERENCE_KEYS = Object.keys(DEFAULTS) as UiPreferenceKey[];
const VALID_KEYS = new Set<UiPreferenceKey>(PREFERENCE_KEYS); // prevents unknown keys from being written
const SYNC_EVENT = 'ui-preferences:sync';

type SyncEventDetail = {
  storageKey: string;
  sourceId: string;
  value: Partial<Record<UiPreferenceKey, unknown>>;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  return fallback;
};

const readLegacyPreference = (key: UiPreferenceKey, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    // Supports values written by both JSON.stringify and plain strings.
    const parsed = JSON.parse(raw);
    return parseBoolean(parsed, fallback);
  } catch {
    return fallback;
  }
};

/**
 * Bumped when a default changes in a way that should reach profiles that never
 * chose the old value.
 *
 * Preferences are written to storage in full on first mount, so every profile
 * carries an explicit copy of whatever the defaults were at the time - a stored
 * value says nothing about whether anyone picked it. Without a marker, a
 * changed default would only ever reach new installs. Each migration runs once
 * and stamps this version, so a choice made afterwards is never overwritten.
 */
export const UI_PREFERENCES_VERSION = 2;

const versionKey = (storageKey: string): string => `${storageKey}.version`;

/**
 * Applies default changes that shipped after a profile was first written.
 *
 * v1: `showThinking` off. A replayed transcript carries no thinking duration,
 * so the collapsed row reads "Thought for a few seconds" on every entry
 * whatever actually happened, and the reasoning is already behind a click.
 */
const migratePreferences = (
  preferences: UiPreferences,
  storedVersion: number,
): UiPreferences => {
  if (storedVersion >= UI_PREFERENCES_VERSION) {
    return preferences;
  }
  return { ...preferences, showThinking: DEFAULTS.showThinking };
};

const readStoredVersion = (storageKey: string): number => {
  try {
    const raw = localStorage.getItem(versionKey(storageKey));
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

/**
 * Stamps the version at load, next to the state the migration just produced.
 *
 * It deliberately does not ride along with the ordinary save effect. That
 * effect runs for state a component is already holding, and a hot module
 * replacement swaps this file underneath mounted hooks without re-running
 * their initializer - so the new stamp landed beside a value that had never
 * been migrated, and every later load then skipped the migration it was owed.
 */
const stampVersion = (storageKey: string, preferences: UiPreferences): void => {
  try {
    // State and stamp go down together. The hook has several instances and they
    // do not all mount in the same commit, so a stamp written on its own let a
    // later instance read the still-unmigrated state, skip the migration it was
    // owed, and then persist that stale value over the migrated one.
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    localStorage.setItem(versionKey(storageKey), String(UI_PREFERENCES_VERSION));
  } catch {
    // Storage is best-effort; a failed write only means the migration is
    // evaluated again next load, which is harmless because it is idempotent.
  }
};

/**
 * Exposed for tests: the migration only observably matters at load, and a
 * hook-level test would have to stand up React to reach it.
 */
export const readInitialPreferencesForTest = (storageKey: string): UiPreferences =>
  readInitialPreferences(storageKey);

function readInitialPreferences(storageKey: string): UiPreferences {
  if (typeof window === 'undefined') {
    return DEFAULTS;
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedRecord = parsed as Record<string, unknown>;

        const stored = PREFERENCE_KEYS.reduce((acc, key) => {
          acc[key] = parseBoolean(parsedRecord[key], DEFAULTS[key]);
          return acc;
        }, { ...DEFAULTS });

        const migrated = migratePreferences(stored, readStoredVersion(storageKey));
        stampVersion(storageKey, migrated);
        return migrated;
      }
    }
  } catch {
    // Fall back to legacy keys when unified key is missing or invalid.
  }

  const legacy = PREFERENCE_KEYS.reduce((acc, key) => {
    acc[key] = readLegacyPreference(key, DEFAULTS[key]);
    return acc;
  }, { ...DEFAULTS });

  const migratedLegacy = migratePreferences(legacy, readStoredVersion(storageKey));
  stampVersion(storageKey, migratedLegacy);
  return migratedLegacy;
}

function reducer(state: UiPreferences, action: UiPreferencesAction): UiPreferences {
  switch (action.type) {
    case 'set': {
      const { key, value } = action;
      if (!VALID_KEYS.has(key)) {
        return state;
      }

      const nextValue = parseBoolean(value, state[key]);
      if (state[key] === nextValue) {
        return state;
      }

      return { ...state, [key]: nextValue };
    }
    case 'set_many': {
      const updates = action.value || {};
      let changed = false;
      const nextState = { ...state };

      for (const key of PREFERENCE_KEYS) {
        if (!(key in updates)) continue;

        const value = updates[key];
        const nextValue = parseBoolean(value, state[key]);
        if (nextState[key] !== nextValue) {
          nextState[key] = nextValue;
          changed = true;
        }
      }

      return changed ? nextState : state;
    }
    case 'reset':
      return { ...DEFAULTS, ...(action.value || {}) };
    default:
      return state;
  }
}

export function useUiPreferences(storageKey = 'uiPreferences') {
  const instanceIdRef = useRef(`ui-preferences-${Math.random().toString(36).slice(2)}`);
  const [state, dispatch] = useReducer(
    reducer,
    storageKey,
    readInitialPreferences
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(state));

    window.dispatchEvent(
      new CustomEvent<SyncEventDetail>(SYNC_EVENT, {
        detail: {
          storageKey,
          sourceId: instanceIdRef.current,
          value: state,
        },
      })
    );
  }, [state, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyExternalUpdate = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      dispatch({ type: 'set_many', value: value as Partial<Record<UiPreferenceKey, unknown>> });
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue === null) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue);
        applyExternalUpdate(parsed);
      } catch {
        // Ignore malformed storage updates.
      }
    };

    const handleSyncEvent = (event: Event) => {
      const syncEvent = event as CustomEvent<SyncEventDetail>;
      const detail = syncEvent.detail;
      if (!detail || detail.storageKey !== storageKey || detail.sourceId === instanceIdRef.current) {
        return;
      }

      applyExternalUpdate(detail.value);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SYNC_EVENT, handleSyncEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SYNC_EVENT, handleSyncEvent as EventListener);
    };
  }, [storageKey]);

  const setPreference = (key: UiPreferenceKey, value: unknown) => {
    dispatch({ type: 'set', key, value });
  };

  const setPreferences = (value: Partial<Record<UiPreferenceKey, unknown>>) => {
    dispatch({ type: 'set_many', value });
  };

  const resetPreferences = (value?: Partial<UiPreferences>) => {
    dispatch({ type: 'reset', value });
  };

  return {
    preferences: state,
    setPreference,
    setPreferences,
    resetPreferences,
    dispatch,
  };
}
