import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project, ProjectSession } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';

export type WorkspaceCandidateReason = 'mention' | 'partial' | 'recent';

export interface WorkspaceCandidate {
  path: string;
  name: string;
  score: number;
  reason: WorkspaceCandidateReason;
}

interface UseWorkspaceTargetArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  input: string;
}

interface UseWorkspaceTargetResult {
  isWorkspace: boolean;
  candidates: WorkspaceCandidate[];
  /** The candidate a send would descend into, or null to stay at the workspace root. */
  target: WorkspaceCandidate | null;
  pickTarget: (candidate: WorkspaceCandidate | null) => void;
  /** True once the user has made an explicit pick that later typing must not override. */
  pinned: boolean;
  resolveForSend: (text: string) => Promise<WorkspaceCandidate | null>;
}

/** A resolved candidate strong enough to auto-target without the user picking it. */
const AUTO_TARGET_SCORE = 80;
const RESOLVE_DEBOUNCE_MS = 300;
const RESOLVE_TEXT_MAX = 2000;

/**
 * Resolves, for a new task started in a workspace-root project (e.g.
 * `~/Projects`), which child repo the first message is probably about.
 *
 * Only active for a brand-new task (no session yet) with a project selected.
 * An empty-text probe on mount tells the composer whether the project is a
 * workspace at all; once it is, typing re-queries the server (debounced) for
 * scored candidates. A score at or above `AUTO_TARGET_SCORE` auto-targets the
 * top candidate, but a user's own pick always wins until the input clears or
 * the session is established, at which point the pin releases.
 */
export function useWorkspaceTarget({ selectedProject, selectedSession, currentSessionId, input }: UseWorkspaceTargetArgs): UseWorkspaceTargetResult {
  const projectId = selectedProject?.projectId ?? null;
  const isNewTask = !selectedSession && !currentSessionId;
  const [isWorkspace, setIsWorkspace] = useState(false);
  const [candidates, setCandidates] = useState<WorkspaceCandidate[]>([]);
  const [pinnedTarget, setPinnedTarget] = useState<WorkspaceCandidate | null>(null);
  const [pinned, setPinned] = useState(false);
  const latestRequest = useRef<string | null>(null);

  const resolve = useCallback(async (text: string) => {
    if (!projectId) return;
    const cappedText = text.slice(0, RESOLVE_TEXT_MAX);
    const request = `${projectId}\n${cappedText}`;
    latestRequest.current = request;
    try {
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/resolve-target?text=${encodeURIComponent(cappedText)}`);
      if (latestRequest.current !== request) return;
      if (!response.ok) { setIsWorkspace(false); setCandidates([]); return; }
      const body = await response.json();
      if (latestRequest.current !== request) return;
      setIsWorkspace(Boolean(body?.data?.isWorkspace));
      setCandidates(Array.isArray(body?.data?.candidates) ? body.data.candidates : []);
    } catch {
      if (latestRequest.current !== request) return;
      setIsWorkspace(false);
      setCandidates([]);
    }
  }, [projectId]);

  const resolveForSend = useCallback(async (text: string): Promise<WorkspaceCandidate | null> => {
    if (!projectId || pinned) return pinnedTarget;
    const cappedText = text.slice(0, RESOLVE_TEXT_MAX);
    const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/resolve-target?text=${encodeURIComponent(cappedText)}`);
    if (!response.ok) throw new Error(`Failed to resolve workspace target (${response.status})`);
    const body = await response.json();
    if (!body?.data?.isWorkspace) return null;
    const candidates = Array.isArray(body?.data?.candidates) ? body.data.candidates as WorkspaceCandidate[] : [];
    return candidates.length && candidates[0].score >= AUTO_TARGET_SCORE ? candidates[0] : null;
  }, [pinned, pinnedTarget, projectId]);

  // The empty-text probe: once per new-task mount/project change, tells the
  // composer whether there is anything to resolve at all.
  useEffect(() => {
    if (!isNewTask || !projectId) {
      setIsWorkspace(false);
      setCandidates([]);
      return;
    }
    void resolve('');
  }, [isNewTask, projectId, resolve]);

  // Debounced re-query as the user types, only once known to be a workspace.
  useEffect(() => {
    if (!isNewTask || !isWorkspace) return;
    const timer = setTimeout(() => { void resolve(input); }, RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, isNewTask, isWorkspace, resolve]);

  // The pin releases when the box empties or the session is established; a
  // fresh box means a fresh guess is due, and an established session has no
  // more target to pick.
  useEffect(() => {
    if (!input.trim() || selectedSession || currentSessionId) {
      setPinned(false);
      setPinnedTarget(null);
    }
  }, [currentSessionId, input, selectedSession]);

  useEffect(() => {
    setPinned(false);
    setPinnedTarget(null);
  }, [projectId]);

  const pickTarget = useCallback((candidate: WorkspaceCandidate | null) => {
    setPinnedTarget(candidate);
    setPinned(true);
  }, []);

  const autoTarget = candidates.length > 0 && candidates[0].score >= AUTO_TARGET_SCORE ? candidates[0] : null;
  const target = pinned ? pinnedTarget : autoTarget;

  return { isWorkspace, candidates, target, pickTarget, pinned, resolveForSend };
}
