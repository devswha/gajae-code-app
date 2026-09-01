import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import type { ServerEvent } from '../contexts/WebSocketContext';
import { api } from '../utils/api';
import { useAppShellStore } from '../stores/useAppShellStore';
import type { LLMProvider, LoadingProgress, Project, ProjectSession } from '../types/app';

import { mergeExpandedSessionPages, PROJECTS_QUERY_KEY, projectsHaveChanges, useProjectsQuery } from './useProjectsQuery';
import type { SessionActivityMap } from './useSessionProtection';

export { projectsHaveChanges, readProjectsResponse } from './useProjectsQuery';

type UseProjectsStateArgs = { sessionId?: string | null; navigate: NavigateFunction; subscribe: (listener: (event: ServerEvent) => void) => () => void; isMobile: boolean; activeSessions: SessionActivityMap };
type SessionUpsert = ServerEvent & { sessionId: string; providerSessionId?: string | null; provider: LLMProvider; session: ProjectSession; project: { projectId: string; path: string; fullPath: string; displayName: string; isStarred: boolean } | null };
type RegisterOptimisticSessionArgs = { sessionId: string; provider: LLMProvider; project: Project; summary?: string | null };
type ProjectSessionPage = Pick<Project, 'sessions' | 'sessionMeta'>;
type FetchProjectsOptions = { showLoadingState?: boolean };

const fallbackProvider: LLMProvider = 'gjc';
const encode = (value: unknown) => JSON.stringify(value ?? null);
const rowsOf = (project: Project) => project.sessions ?? [];
const rowCount = (project: Project) => rowsOf(project).length;

const providerOf = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim() ? provider as LLMProvider : fallbackProvider;
};

const withProvider = (session: ProjectSession): ProjectSession => ({ ...session, __provider: providerOf(session) });

const combineRows = (first: ProjectSession[], second: ProjectSession[]) => {
  const ids = new Set(first.map((session) => String(session.id)));
  return first.concat(second.filter((session) => !ids.has(String(session.id))));
};

export const reconcileSelectedProject = (selected: Project | null, incoming: Project[]): Project | null => {
  if (!selected) return null;
  const replacement = incoming.find((project) => project.projectId === selected.projectId);
  if (!replacement) return selected;
  const merged = mergeExpandedSessionPages([selected], [replacement])[0];
  return projectsHaveChanges([selected], [merged]) ? merged : selected;
};

const aliasesFor = (event: SessionUpsert) => {
  const aliases = new Set<string>();
  for (const value of [event.sessionId, event.providerSessionId, event.session?.id]) {
    if (typeof value === 'string' && value.trim()) aliases.add(value.trim());
  }
  return aliases;
};

const applySessionUpsert = (project: Project, event: SessionUpsert): Project => {
  const aliases = aliasesFor(event);
  const replacement: ProjectSession = { ...event.session, id: event.sessionId, __provider: event.provider };
  const existing = rowsOf(project);
  const matchingIndex = existing.findIndex((session) => aliases.has(String(session.id)));
  if (matchingIndex < 0) {
    const sessions = [replacement, ...existing];
    const total = Number(project.sessionMeta?.total ?? 0) + 1;
    return { ...project, sessions, sessionMeta: { ...project.sessionMeta, total, hasMore: sessions.length < total } };
  }

  let changed = false;
  const sessions = existing.reduce<ProjectSession[]>((kept, session, index) => {
    if (index === matchingIndex) {
      const next = { ...session, ...replacement };
      if (!replacement.summary?.trim() && session.summary?.trim()) next.summary = session.summary;
      if (encode(next) !== encode(session)) changed = true;
      kept.push(next);
    } else if (aliases.has(String(session.id))) {
      changed = true;
    } else {
      kept.push(session);
    }
    return kept;
  }, []);
  return changed ? { ...project, sessions } : project;
};

const pageIntoProject = (project: Project, page: ProjectSessionPage): Project => {
  const sessions = combineRows(rowsOf(project), page.sessions ?? []);
  const total = Number(page.sessionMeta?.total ?? project.sessionMeta?.total ?? 0);
  return { ...project, sessions, sessionMeta: { ...project.sessionMeta, ...page.sessionMeta, total, hasMore: sessions.length < total } };
};

const withoutSession = (project: Project, sessionId: string): Project => {
  const sessions = rowsOf(project).filter((session) => session.id !== sessionId);
  if (sessions.length === rowsOf(project).length) return project;
  const total = Math.max(0, Number(project.sessionMeta?.total ?? 0) - 1);
  return { ...project, sessions, sessionMeta: { ...project.sessionMeta, total, hasMore: sessions.length < total } };
};

const updateProjectCache = (projects: Project[], event: SessionUpsert): Project[] => {
  const projectId = event.project?.projectId;
  const found = projects.find((project) => projectId
    ? project.projectId === projectId
    : rowsOf(project).some((session) => session.id === event.sessionId));
  if (found) {
    const next = applySessionUpsert(found, event);
    return next === found ? projects : projects.map((project) => project === found ? next : project);
  }
  if (!event.project) return projects;
  const fresh: Project = { ...event.project, sessions: [], sessionMeta: { hasMore: false, total: 0 } } as Project;
  return [...projects, applySessionUpsert(fresh, event)];
};

export function useProjectsState({ sessionId, navigate, subscribe, isMobile, activeSessions }: UseProjectsStateArgs) {
  const client = useQueryClient();
  const query = useProjectsQuery();
  const projects = useMemo(() => query.data ?? [], [query.data]);
  const selectedProject = useAppShellStore((state) => state.selectedProject);
  const selectedSession = useAppShellStore((state) => state.selectedSession);
  const activeTab = useAppShellStore((state) => state.activeTab);
  const sidebarOpen = useAppShellStore((state) => state.sidebarOpen);
  const loadingProgress = useAppShellStore((state) => state.loadingProgress);
  const showSettings = useAppShellStore((state) => state.showSettings);
  const settingsInitialTab = useAppShellStore((state) => state.settingsInitialTab);
  const setSelectedProject = useAppShellStore((state) => state.setSelectedProject);
  const setSelectedSession = useAppShellStore((state) => state.setSelectedSession);
  const setActiveTab = useAppShellStore((state) => state.setActiveTab);
  const setSidebarOpen = useAppShellStore((state) => state.setSidebarOpen);
  const setShowSettings = useAppShellStore((state) => state.setShowSettings);
  const openSettings = useAppShellStore((state) => state.openSettings);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewed = useRef(selectedSession);
  const active = useRef(activeSessions);
  viewed.current = selectedSession;
  active.current = activeSessions;

  const clearAttention = useCallback((id?: string | null) => {
    if (id) useAppShellStore.getState().clearSessionAttention(id);
  }, []);
  const markAttention = useCallback((id?: string | null) => {
    if (!id || id === (viewed.current?.id ?? sessionId ?? null)) return;
    useAppShellStore.getState().markSessionAttention(id, viewed.current?.id ?? sessionId ?? null);
  }, [sessionId]);
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async (_options: FetchProjectsOptions = {}) => { await queryRefetch(); }, [queryRefetch]);

  const registerOptimisticSession = useCallback(({ sessionId: id, provider, project, summary }: RegisterOptimisticSessionArgs) => {
    if (!id || !project?.projectId) return;
    const now = new Date().toISOString();
    const session: ProjectSession = { id, summary: summary ?? '', messageCount: 0, createdAt: now, created_at: now, updated_at: now, lastActivity: now, __provider: provider, __projectId: project.projectId };
    const event: SessionUpsert = { kind: 'session_upserted', sessionId: id, provider, session, project: { projectId: project.projectId, path: project.path || project.fullPath, fullPath: project.fullPath || project.path || '', displayName: project.displayName, isStarred: Boolean(project.isStarred) }, timestamp: now };
    client.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (cached) => updateProjectCache(cached ?? [], event));
    setSelectedProject((current) => current?.projectId === project.projectId ? applySessionUpsert(current, event) : current);
    setSelectedSession((current) => current?.id === id ? { ...current, ...session } : session);
  }, [client, setSelectedProject, setSelectedSession]);

  useEffect(() => {
    setSelectedProject((current) => reconcileSelectedProject(current, query.data ?? []));
  }, [query.data, setSelectedProject]);

  useEffect(() => {
    if (!query.isLoading && projects.length === 1 && !selectedProject && !sessionId) setSelectedProject(projects[0]);
  }, [projects, query.isLoading, selectedProject, sessionId, setSelectedProject]);

  useEffect(() => {
    const receive = (event: ServerEvent) => {
      if (event.kind === 'loading_progress') {
        if (timer.current) clearTimeout(timer.current);
        useAppShellStore.getState().setLoadingProgress(event as unknown as LoadingProgress);
        if (event.phase === 'complete') timer.current = setTimeout(() => {
          useAppShellStore.getState().setLoadingProgress(null);
          timer.current = null;
        }, 500);
        return;
      }
      const id = typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : null;
      const ignored = new Set(['chat_subscribed', 'loading_progress', 'session_upserted', 'status', 'stream_end', 'permission_cancelled', 'websocket_reconnected']);
      if (id && id !== (viewed.current?.id ?? sessionId ?? null) && !ignored.has(event.kind ?? '')) markAttention(id);
      if (event.kind !== 'session_upserted') return;
      const update = event as SessionUpsert;
      if (!update.sessionId || !update.session) return;
      const current = viewed.current;
      if (current?.id === update.sessionId && !active.current.has(update.sessionId)) {
        void client.invalidateQueries({ queryKey: ['messages', update.sessionId] });
      } else {
        markAttention(update.sessionId);
      }
      client.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (cached) => updateProjectCache(cached ?? [], update));
      setSelectedProject((project) => {
        if (!project) return project;
        const applies = update.project ? project.projectId === update.project.projectId : rowsOf(project).some((session) => session.id === update.sessionId);
        return applies ? applySessionUpsert(project, update) : project;
      });
      const alias = typeof update.providerSessionId === 'string' && update.providerSessionId !== update.sessionId
        ? update.providerSessionId
        : null;
      if (!alias) return;
      const normalized: ProjectSession = { ...update.session, id: update.sessionId, __provider: update.provider, __projectId: update.project?.projectId ?? current?.__projectId };
      setSelectedSession((session) => session?.id === alias ? { ...session, ...normalized } : session);
      if (sessionId === alias) navigate(`/session/${update.sessionId}`);
    };
    return subscribe(receive);
  }, [client, markAttention, navigate, sessionId, setSelectedProject, setSelectedSession, subscribe]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { clearAttention(selectedSession?.id ?? sessionId ?? null); }, [clearAttention, selectedSession?.id, sessionId]);

  useEffect(() => {
    if (!sessionId || !projects.length) return;
    for (const project of projects) {
      const session = rowsOf(project).find((candidate) => candidate.id === sessionId);
      if (!session) continue;
      const normalized = withProvider(session);
      if (selectedProject?.projectId !== project.projectId) setSelectedProject(project);
      if (selectedSession?.id !== sessionId || selectedSession.__provider !== normalized.__provider) setSelectedSession(normalized);
      return;
    }
    if (selectedSession?.id !== sessionId && selectedProject) {
      setSelectedSession({ id: sessionId, __provider: fallbackProvider, __projectId: selectedProject.projectId, summary: '' });
    }
  }, [projects, selectedProject, selectedSession?.__provider, selectedSession?.id, sessionId, setSelectedProject, setSelectedSession]);

  const handleProjectSelect = useCallback((project: Project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    navigate('/');
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, navigate, setSelectedProject, setSelectedSession, setSidebarOpen]);

  const handleSessionSelect = useCallback((session: ProjectSession) => {
    clearAttention(session.id);
    setSelectedSession(session);
    if (activeTab === 'tasks' || activeTab === 'browser') setActiveTab('chat');
    if (isMobile && session.__projectId !== selectedProject?.projectId) setSidebarOpen(false);
    navigate(`/session/${session.id}`);
  }, [activeTab, clearAttention, isMobile, navigate, selectedProject?.projectId, setActiveTab, setSelectedSession, setSidebarOpen]);

  const handleNewSession = useCallback((project: Project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    setActiveTab('chat');
    setNewSessionTrigger((trigger) => trigger + 1);
    navigate('/');
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, navigate, setActiveTab, setSelectedProject, setSelectedSession, setSidebarOpen]);

  const handleSessionDelete = useCallback((id: string) => {
    clearAttention(id);
    if (selectedSession?.id === id) {
      setSelectedSession(null);
      navigate('/');
    }
    client.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (cached) => (cached ?? []).map((project) => withoutSession(project, id)));
  }, [clearAttention, client, navigate, selectedSession?.id, setSelectedSession]);

  const handleSidebarRefresh = useCallback(async () => {
    try {
      await query.refetch();
      const refreshed = client.getQueryData<Project[]>(PROJECTS_QUERY_KEY) ?? [];
      const project = selectedProject && refreshed.find((candidate) => candidate.projectId === selectedProject.projectId);
      if (!project) return;
      if (encode(project) !== encode(selectedProject)) setSelectedProject(project);
      const session = selectedSession && rowsOf(project).find((candidate) => candidate.id === selectedSession.id);
      if (!session) return;
      const normalized = session.__provider || !selectedSession?.__provider ? session : { ...session, __provider: selectedSession.__provider };
      if (encode(normalized) !== encode(selectedSession)) setSelectedSession(normalized);
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [client, query, selectedProject, selectedSession, setSelectedProject, setSelectedSession]);

  const loadMoreProjectSessions = useCallback(async (projectId: string) => {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project) return;
    const offset = rowCount(project);
    if (Number(project.sessionMeta?.total ?? 0) > 0 && offset >= Number(project.sessionMeta?.total)) return;
    const response = await api.projectSessions(projectId, { limit: 20, offset });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
      const error = body.error;
      throw new Error(typeof error === 'string' ? error : error?.message ?? `Failed to load more sessions for project ${projectId}`);
    }
    const page = await response.json() as ProjectSessionPage;
    let selected: Project | null = null;
    client.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (cached) => (cached ?? []).map((candidate) => {
      if (candidate.projectId !== projectId) return candidate;
      const merged = pageIntoProject(candidate, page);
      selected = merged;
      return merged;
    }));
    if (selectedProject?.projectId === projectId && selected) setSelectedProject(selected);
  }, [client, projects, selectedProject?.projectId, setSelectedProject]);

  const handleProjectDelete = useCallback((projectId: string) => {
    if (selectedProject?.projectId === projectId) {
      setSelectedProject(null);
      setSelectedSession(null);
      navigate('/');
    }
    client.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (cached) => (cached ?? []).filter((project) => project.projectId !== projectId));
  }, [client, navigate, selectedProject?.projectId, setSelectedProject, setSelectedSession]);

  const sidebarSharedProps = useMemo(() => ({ activeSessions, onProjectSelect: handleProjectSelect, onSessionSelect: handleSessionSelect, onNewSession: handleNewSession, onSessionDelete: handleSessionDelete, onLoadMoreSessions: loadMoreProjectSessions, onProjectDelete: handleProjectDelete, onRefresh: handleSidebarRefresh, isMobile }), [activeSessions, handleNewSession, handleProjectDelete, handleProjectSelect, handleSessionDelete, handleSessionSelect, handleSidebarRefresh, isMobile, loadMoreProjectSessions]);

  return { projects, selectedProject, selectedSession, activeTab, sidebarOpen, isLoadingProjects: query.isLoading, loadingProgress, isInputFocused, showSettings, settingsInitialTab, newSessionTrigger, setActiveTab, setSidebarOpen, setIsInputFocused, setShowSettings, openSettings, fetchProjects: refetch, refreshProjectsSilently: refetch, registerOptimisticSession, sidebarSharedProps, handleProjectSelect, handleSessionSelect, handleNewSession, handleSessionDelete, loadMoreProjectSessions, handleProjectDelete, handleSidebarRefresh };
}
