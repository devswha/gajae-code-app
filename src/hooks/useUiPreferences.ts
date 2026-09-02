import { useEffect, useReducer, useRef } from 'react';

import { DEFAULT_TOOL_OUTPUT_DENSITY, isToolOutputDensity } from '../components/chat/utils/toolOutputDensity';
import type { ToolOutputDensity } from '../components/chat/utils/toolOutputDensity';

/**
 * `showRawParameters` and `showThinking` are superseded by `toolOutputDensity`
 * (version 3): nothing reads them any more, but they stay in the record for one
 * release so a downgrade still finds them and an upgrade can derive from them.
 */
type UiPreferences = { showRawParameters: boolean; showThinking: boolean; showImagePreviews: boolean; sendByCtrlEnter: boolean; sidebarVisible: boolean; voiceEnabled: boolean; toolOutputDensity: ToolOutputDensity };
type UiPreferenceKey = keyof UiPreferences;
type UiPreferencesAction =
  | { type: 'set'; key: UiPreferenceKey; value: unknown }
  | { type: 'set_many'; value?: Partial<Record<UiPreferenceKey, unknown>> }
  | { type: 'reset'; value?: Partial<UiPreferences> };

const initialValues: UiPreferences = {
  showRawParameters: false,
  showThinking: false,
  showImagePreviews: true,
  sendByCtrlEnter: false,
  sidebarVisible: true,
  voiceEnabled: false,
  toolOutputDensity: DEFAULT_TOOL_OUTPUT_DENSITY,
};
const preferenceNames = Object.keys(initialValues) as UiPreferenceKey[];
const preferenceEvent = 'ui-preferences:sync';

export const UI_PREFERENCES_VERSION = 3;
const DENSITY_PREFERENCE_VERSION = 3;

type SyncEventDetail = { storageKey: string; sourceId: string; value: Partial<Record<UiPreferenceKey, unknown>> };

const asBoolean = (candidate: unknown, otherwise: boolean): boolean => {
  if (typeof candidate === 'boolean') return candidate;
  if (candidate === 'true') return true;
  if (candidate === 'false') return false;
  return otherwise;
};

const coerce = <K extends UiPreferenceKey>(key: K, candidate: unknown, otherwise: UiPreferences[K]): UiPreferences[K] => {
  if (key === 'toolOutputDensity') {
    return (isToolOutputDensity(candidate) ? candidate : otherwise) as UiPreferences[K];
  }
  return asBoolean(candidate, otherwise as boolean) as UiPreferences[K];
};

const preferencesVersionKey = (storageKey: string) => `${storageKey}.version`;

const storageValue = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const deserializeRecord = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const decoded: unknown = JSON.parse(raw);
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const legacyBoolean = (key: UiPreferenceKey): unknown => {
  const raw = storageValue(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const collectPreferences = (source: Record<string, unknown> | null): UiPreferences => {
  const result = { ...initialValues };
  if (!source) return result;
  for (const preference of preferenceNames) {
    (result as Record<UiPreferenceKey, unknown>)[preference] = coerce(preference, source[preference], result[preference]);
  }
  return result;
};

const storedVersion = (storageKey: string): number => {
  const parsed = Number.parseInt(storageValue(preferencesVersionKey(storageKey)) ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Version 2 undid a default that had been written into every profile (thinking
 * on). Version 3 folds the two display switches into one density level: a
 * profile that had either one on was asking for more than the default shows,
 * so it lands on `detailed`; everything else keeps the balanced default. The
 * order matters - the thinking reset runs first, so a stale default never
 * counts as a choice.
 */
const applyMigrations = (preferences: UiPreferences, version: number): UiPreferences => {
  let migrated = preferences;
  if (version < 2) {
    migrated = { ...migrated, showThinking: initialValues.showThinking };
  }
  if (version < DENSITY_PREFERENCE_VERSION) {
    migrated = {
      ...migrated,
      toolOutputDensity: migrated.showThinking || migrated.showRawParameters ? 'detailed' : DEFAULT_TOOL_OUTPUT_DENSITY,
    };
  }
  return migrated;
};

const saveLoadedPreferences = (storageKey: string, preferences: UiPreferences) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    localStorage.setItem(preferencesVersionKey(storageKey), String(UI_PREFERENCES_VERSION));
  } catch {
    // Persistence is optional in restricted browsing contexts.
  }
};

function readInitialPreferences(storageKey: string): UiPreferences {
  if (typeof window === 'undefined') return initialValues;

  const unified = deserializeRecord(storageValue(storageKey));
  const legacy = unified ?? Object.fromEntries(preferenceNames.map((key) => [key, legacyBoolean(key)]));
  const migrated = applyMigrations(collectPreferences(legacy), storedVersion(storageKey));
  saveLoadedPreferences(storageKey, migrated);
  return migrated;
}

export const readInitialPreferencesForTest = (storageKey: string): UiPreferences => readInitialPreferences(storageKey);

const updateState = (current: UiPreferences, changes: Partial<Record<UiPreferenceKey, unknown>>): UiPreferences => {
  let updated: UiPreferences | null = null;
  for (const name of preferenceNames) {
    if (!(name in changes)) continue;
    const value = coerce(name, changes[name], current[name]);
    if (value !== current[name]) {
      updated ??= { ...current };
      (updated as Record<UiPreferenceKey, unknown>)[name] = value;
    }
  }
  return updated ?? current;
};

const reducer = (current: UiPreferences, action: UiPreferencesAction): UiPreferences => {
  if (action.type === 'set') return updateState(current, { [action.key]: action.value });
  if (action.type === 'set_many') return updateState(current, action.value ?? {});
  if (action.type === 'reset') return { ...initialValues, ...(action.value ?? {}) };
  return current;
};

export function useUiPreferences(storageKey = 'uiPreferences') {
  const source = useRef(`ui-preferences-${Math.random().toString(36).slice(2)}`);
  const [preferences, dispatch] = useReducer(reducer, storageKey, readInitialPreferences);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    window.dispatchEvent(new CustomEvent<SyncEventDetail>(preferenceEvent, {
      detail: { storageKey, sourceId: source.current, value: preferences },
    }));
  }, [preferences, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const accept = (candidate: unknown) => {
      const record = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as Partial<Record<UiPreferenceKey, unknown>>
        : null;
      if (record) dispatch({ type: 'set_many', value: record });
    };
    const receiveStorage = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue !== null) accept(deserializeRecord(event.newValue));
    };
    const receiveLocal = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail;
      if (detail && detail.storageKey === storageKey && detail.sourceId !== source.current) accept(detail.value);
    };
    window.addEventListener('storage', receiveStorage);
    window.addEventListener(preferenceEvent, receiveLocal as EventListener);
    return () => {
      window.removeEventListener('storage', receiveStorage);
      window.removeEventListener(preferenceEvent, receiveLocal as EventListener);
    };
  }, [storageKey]);

  return {
    preferences,
    setPreference: (key: UiPreferenceKey, value: unknown) => dispatch({ type: 'set', key, value }),
    setPreferences: (value: Partial<Record<UiPreferenceKey, unknown>>) => dispatch({ type: 'set_many', value }),
    resetPreferences: (value?: Partial<UiPreferences>) => dispatch({ type: 'reset', value }),
    dispatch,
  };
}
