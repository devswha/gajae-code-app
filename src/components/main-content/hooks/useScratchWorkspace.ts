import { useCallback, useState } from 'react';

import { useProjectsQuery } from '../../../hooks/useProjectsQuery';
import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';

type ScratchResponse = {
  success?: boolean;
  data?: { project?: Project };
  error?: string | { message?: string; details?: unknown };
};

const failureMessage = (payload: ScratchResponse, status: number): string => {
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === 'object') {
    const details = typeof payload.error.details === 'string' ? payload.error.details : null;
    const message = details ?? payload.error.message;
    if (message?.trim()) return message;
  }
  return `HTTP ${status}`;
};

/**
 * One click from an empty workspace to a conversation: the server creates and
 * registers the scratch folder, the project list is refreshed so the sidebar
 * has the row, and the new session flow opens on it - the same path "New work
 * item" takes for a project the user picked.
 */
export function useScratchWorkspace(onNewSession: (project: Project) => void) {
  const { refetch } = useProjectsQuery();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const response = await api.startScratchWorkspace();
      const payload = (await response.json().catch(() => ({}))) as ScratchResponse;
      const created = payload.data?.project;
      if (!response.ok || !created) throw new Error(failureMessage(payload, response.status));
      const refreshed = (await refetch()).data ?? [];
      onNewSession(refreshed.find((project) => project.projectId === created.projectId) ?? created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, onNewSession, refetch]);

  return { start, isStarting, error };
}
