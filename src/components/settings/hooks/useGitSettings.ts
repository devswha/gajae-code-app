import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

type GitConfigResponse = { gitName?: string; gitEmail?: string; error?: string };
type SaveStatus = 'success' | 'error' | null;

const gitConfigEndpoint = '/api/user/git-config';

export function useGitSettings() {
  const [name, updateName] = useState('');
  const [email, updateEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);
  const statusTimeout = useRef<number | null>(null);

  const clearSaveStatus = useCallback(() => {
    const timeout = statusTimeout.current;
    if (timeout !== null) {
      window.clearTimeout(timeout);
      statusTimeout.current = null;
    }
    setStatus(null);
  }, []);

  const loadGitConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(gitConfigEndpoint);
      if (response.ok) {
        const config = await response.json() as GitConfigResponse;
        updateName(config.gitName || '');
        updateEmail(config.gitEmail || '');
      }
    } catch (error) {
      console.error('Error loading git config:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveGitConfig = useCallback(async () => {
    setSaving(true);
    try {
      const response = await authenticatedFetch(gitConfigEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitName: name, gitEmail: email }),
      });

      if (response.ok) {
        setStatus('success');
        statusTimeout.current = window.setTimeout(() => {
          setStatus(null);
          statusTimeout.current = null;
        }, 3000);
        return;
      }

      const failure = await response.json() as GitConfigResponse;
      console.error('Failed to save git config:', failure.error);
      setStatus('error');
    } catch (error) {
      console.error('Error saving git config:', error);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }, [email, name]);

  useEffect(() => {
    void loadGitConfig();
  }, [loadGitConfig]);

  useEffect(() => () => {
    const timeout = statusTimeout.current;
    if (timeout !== null) {
      window.clearTimeout(timeout);
    }
  }, []);

  return {
    gitName: name,
    setGitName: updateName,
    gitEmail: email,
    setGitEmail: updateEmail,
    isLoading: loading,
    isSaving: saving,
    saveStatus: status,
    clearSaveStatus,
    saveGitConfig,
  };
}
