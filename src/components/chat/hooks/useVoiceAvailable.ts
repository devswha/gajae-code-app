import { useEffect, useState } from 'react';

import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '../../../hooks/useVoiceConfig';
import { authenticatedFetch } from '../../../utils/api';

const PREFERENCES_KEY = 'uiPreferences';
const PREFERENCES_CHANGED = 'ui-preferences:sync';
let pendingHealthCheck: Promise<boolean> | null = null;

function preferenceEnablesVoice(): boolean {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) return false;
    const preferences = JSON.parse(saved);
    return preferences?.voiceEnabled === true || preferences?.voiceEnabled === 'true';
  } catch {
    return false;
  }
}

function configuredOnServer(): Promise<boolean> {
  if (pendingHealthCheck) return pendingHealthCheck;

  pendingHealthCheck = authenticatedFetch('/api/voice/health')
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const body = await response.json();
      return body?.configured === true;
    })
    .finally(() => {
      pendingHealthCheck = null;
    });

  return pendingHealthCheck;
}

export function useVoiceAvailable(): boolean {
  const [preferenceEnabled, setPreferenceEnabled] = useState(() =>
    typeof window !== 'undefined' && preferenceEnablesVoice(),
  );
  const [backendAvailable, setBackendAvailable] = useState(false);

  useEffect(() => {
    const refreshPreference = () => setPreferenceEnabled(preferenceEnablesVoice());
    window.addEventListener('storage', refreshPreference);
    window.addEventListener(PREFERENCES_CHANGED, refreshPreference as EventListener);

    return () => {
      window.removeEventListener('storage', refreshPreference);
      window.removeEventListener(PREFERENCES_CHANGED, refreshPreference as EventListener);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let latestServerCheck = 0;

    const refreshBackend = async () => {
      if (!preferenceEnabled) {
        setBackendAvailable(false);
        return;
      }

      if (readVoiceConfig().baseUrl.trim()) {
        setBackendAvailable(true);
        return;
      }

      const checkNumber = ++latestServerCheck;
      try {
        const isConfigured = await configuredOnServer();
        if (mounted && checkNumber === latestServerCheck) setBackendAvailable(isConfigured);
      } catch {
        if (mounted && checkNumber === latestServerCheck) setBackendAvailable(false);
      }
    };

    void refreshBackend();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, refreshBackend);
    return () => {
      mounted = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, refreshBackend);
    };
  }, [preferenceEnabled]);

  return preferenceEnabled && backendAvailable;
}
