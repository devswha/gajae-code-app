import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import {
  applyInterfaceFontSize,
  INTERFACE_FONT_SIZE_STORAGE_KEY,
  readInterfaceFontSize,
} from '../../../utils/interfaceFontSize';
import { setNotificationSoundEnabled } from '../../../utils/notificationSound';
import type {
  NotificationPreferencesState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

type UseSettingsControllerArgs = { isOpen: boolean; initialTab: string };
type StoredProjectSettings = { projectSortOrder?: ProjectSortOrder };
type NotificationPreferencesResponse = { success?: boolean; preferences?: NotificationPreferencesState };

const tabNames: SettingsMainTab[] = ['appearance', 'git', 'voice', 'notifications', 'automation', 'about'];

function chooseTab(value: string): SettingsMainTab {
  return tabNames.includes(value as SettingsMainTab) ? value as SettingsMainTab : 'appearance';
}

function decodeStoredValue<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function notificationDefaults(): NotificationPreferencesState {
  return {
    channels: { inApp: true, desktop: false, sound: true },
    events: { actionRequired: true, stop: true, error: true },
  };
}

function normalizeNotificationPreferences(value?: Partial<NotificationPreferencesState> | null): NotificationPreferencesState {
  const fallback = notificationDefaults();
  return {
    channels: {
      inApp: value?.channels?.inApp ?? fallback.channels.inApp,
      desktop: value?.channels?.desktop ?? fallback.channels.desktop,
      sound: value?.channels?.sound ?? fallback.channels.sound,
    },
    events: {
      actionRequired: value?.events?.actionRequired ?? fallback.events.actionRequired,
      stop: value?.events?.stop ?? fallback.events.stop,
      error: value?.events?.error ?? fallback.events.error,
    },
  };
}

export function useSettingsController({ isOpen, initialTab }: UseSettingsControllerArgs) {
  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => chooseTab(initialTab));
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [interfaceFontSize, setInterfaceFontSize] = useState(readInterfaceFontSize);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferencesState>(notificationDefaults);
  const saveTimer = useRef<number | null>(null);
  const hasJustOpened = useRef(true);

  const loadSettings = useCallback(async () => {
    try {
      const saved = decodeStoredValue<StoredProjectSettings>(localStorage.getItem('claude-settings'), {});
      setProjectSortOrder(saved.projectSortOrder === 'date' ? 'date' : 'name');
      try {
        const response = await authenticatedFetch('/api/settings/notification-preferences');
        if (!response.ok) {
          setNotificationPreferences(notificationDefaults());
          return;
        }
        const payload = await response.json() as NotificationPreferencesResponse;
        setNotificationPreferences(
          payload.success && payload.preferences
            ? normalizeNotificationPreferences(payload.preferences)
            : notificationDefaults(),
        );
      } catch {
        setNotificationPreferences(notificationDefaults());
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      setProjectSortOrder('name');
      setNotificationPreferences(notificationDefaults());
    }
  }, []);

  const saveSettings = useCallback(async () => {
    setSaveStatus(null);
    try {
      localStorage.setItem('claude-settings', JSON.stringify({ projectSortOrder }));
      const response = await authenticatedFetch('/api/settings/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify(notificationPreferences),
      });
      if (!response.ok) throw new Error('Failed to save notification preferences');
      setSaveStatus('success');
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    }
  }, [notificationPreferences, projectSortOrder]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(chooseTab(initialTab));
      void loadSettings();
    }
  }, [initialTab, isOpen, loadSettings]);

  useEffect(() => {
    setNotificationSoundEnabled(notificationPreferences.channels.sound);
  }, [notificationPreferences.channels.sound]);

  useEffect(() => {
    localStorage.setItem(INTERFACE_FONT_SIZE_STORAGE_KEY, interfaceFontSize);
    applyInterfaceFontSize(interfaceFontSize);
  }, [interfaceFontSize]);

  useEffect(() => {
    if (hasJustOpened.current) {
      hasJustOpened.current = false;
      return;
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveSettings(); }, 500);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [saveSettings]);

  useEffect(() => {
    if (saveStatus === null) return;
    const timeout = window.setTimeout(() => setSaveStatus(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  useEffect(() => {
    if (isOpen) hasJustOpened.current = true;
  }, [isOpen]);

  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    interfaceFontSize,
    setInterfaceFontSize,
    notificationPreferences,
    setNotificationPreferences,
  };
}
