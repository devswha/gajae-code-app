import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import { forgetSessionStorage } from '../../chat/utils/chatStorage';
import { useAppShellStore } from '../../../stores/useAppShellStore';
import { usePaletteOps } from '../../../stores/usePaletteOpsStore';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import { api } from '../../../utils/api';
import { downloadBlob, filenameFromContentDisposition } from '../../../utils/download';
import type { ArchivedProjectListItem, ArchivedSessionListItem, DeleteProjectConfirmation, ProjectSortOrder, SessionDeleteConfirmation, SessionWithProvider } from '../types/types';
import { clearLegacyStarredProjectIds, getAllSessions, readLegacyStarredProjectIds, readProjectSortOrder, sortProjects } from '../utils/utils';

type ArchivedSessionsPayload = { success?: boolean; data?: { sessions?: ArchivedSessionListItem[] } };
type ArchivedProjectsPayload = { success?: boolean; data?: { projects?: ArchivedProjectListItem[] } };
type UseSidebarControllerArgs = { projects: Project[]; selectedProject: Project | null; selectedSession: ProjectSession | null; isLoading: boolean; isMobile: boolean; t: TFunction; onRefresh: () => Promise<void> | void; onProjectSelect: (project: Project) => void; onSessionSelect: (session: ProjectSession) => void; onSessionDelete?: (sessionId: string) => void; onLoadMoreSessions?: (projectId: string) => Promise<void> | void; onProjectDelete?: (projectId: string) => void; setSidebarVisible: (visible: boolean) => void; sidebarVisible: boolean };

const cloneWith = <T,>(previous: Set<T>, value: T, include: boolean) => {
  const next = new Set(previous);
  if (include) next.add(value);
  else next.delete(value);
  return next;
};

const errorMessage = (payload: { error?: string | { message?: string } }, fallback: string) => {
  const { error } = payload;
  return typeof error === 'string' ? error : error?.message || fallback;
};

export function useSidebarController(args: UseSidebarControllerArgs) {
  const { projects, selectedProject, isLoading, isMobile, t, onRefresh, onProjectSelect, onSessionSelect, onSessionDelete, onLoadMoreSessions, onProjectDelete, setSidebarVisible, sidebarVisible } = args;
  const palette = usePaletteOps();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  // Shared with the empty main pane, whose only action is the same dialog.
  const showNewProject = useAppShellStore((state) => state.newProjectOpen);
  const setShowNewProject = useAppShellStore((state) => state.setNewProjectOpen);
  const [editingName, setEditingName] = useState('');
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveLoadError, setArchiveLoadError] = useState<string | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProjectListItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionListItem[]>([]);
  const [isArchivedSessionsLoading, setIsArchivedSessionsLoading] = useState(false);
  const [starOverrides, setStarOverrides] = useState<Map<string, boolean>>(new Map());
  const [loadingMoreProjects, setLoadingMoreProjects] = useState<Set<string>>(new Set());
  const starRequests = useRef(new Map<string, number>());
  const migrated = useRef(false);
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => setInitialSessionsLoaded(new Set()), [projects]);

  useEffect(() => {
    const id = selectedProject?.projectId;
    if (!id) return;
    setExpandedProjects((previous) => previous.has(id) ? previous : cloneWith(previous, id, true));
  }, [selectedProject?.projectId]);

  useEffect(() => {
    if (isLoading || projects.length === 0) return;
    setInitialSessionsLoaded(new Set(projects.filter((project) => project.sessions && project.sessions.length >= 0).map((project) => project.projectId)));
  }, [isLoading, projects]);

  useEffect(() => {
    const syncSort = () => setProjectSortOrder(readProjectSortOrder());
    const onStorage = (event: StorageEvent) => { if (event.key === 'claude-settings') syncSort(); };
    syncSort();
    window.addEventListener('storage', onStorage);
    const interval = setInterval(() => { if (document.hasFocus()) syncSort(); }, 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);

  const fetchArchivedSessions = useCallback(async () => {
    setIsArchivedSessionsLoading(true);
    setArchiveLoadError(null);
    try {
      const responses = await Promise.all([api.archivedProjects(), api.getArchivedSessions()]);
      const [projectsResponse, sessionsResponse] = responses;
      if (!projectsResponse.ok) throw new Error(`Failed to load archived projects: ${projectsResponse.status}`);
      if (!sessionsResponse.ok) throw new Error(`Failed to load archived sessions: ${sessionsResponse.status}`);
      const [projectPayload, sessionPayload] = await Promise.all([projectsResponse.json() as Promise<ArchivedProjectsPayload>, sessionsResponse.json() as Promise<ArchivedSessionsPayload>]);
      const nextProjects = Array.isArray(projectPayload.data?.projects) ? projectPayload.data.projects : [];
      const projectIds = new Set(nextProjects.map((project) => project.projectId));
      const nextSessions = Array.isArray(sessionPayload.data?.sessions) ? sessionPayload.data.sessions.filter((session) => !session.projectId || !projectIds.has(session.projectId)) : [];
      setArchivedProjects(nextProjects);
      setArchivedSessions(nextSessions);
    } catch (error) {
      console.error('[Sidebar] Failed to load archived sessions:', error);
      setArchiveLoadError(t('archived.loadError', 'Unable to load archive. Try again.'));
    } finally {
      setIsArchivedSessionsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (migrated.current) return;
    const ids = readLegacyStarredProjectIds();
    if (!ids.length) return;
    migrated.current = true;
    void (async () => {
      try {
        await api.migrateLegacyProjectStars(ids);
        await refreshRef.current();
      } catch (error) {
        console.error('[Sidebar] Failed to migrate legacy starred projects:', error);
      } finally {
        clearLegacyStarredProjectIds();
      }
    })();
  }, [onRefresh]);

  useEffect(() => {
    setStarOverrides((previous) => {
      const next = new Map(previous);
      for (const [id, starred] of previous) {
        const project = projects.find((candidate) => candidate.projectId === id);
        if (!project || Boolean(project.isStarred) === starred) next.delete(id);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [projects]);

  const resolveStar = useCallback((projectId: string) => starOverrides.has(projectId) ? Boolean(starOverrides.get(projectId)) : Boolean(projects.find((project) => project.projectId === projectId)?.isStarred), [projects, starOverrides]);
  const toggleProject = useCallback((projectId: string) => setExpandedProjects((previous) => previous.has(projectId) ? new Set() : new Set([projectId])), []);
  const handleSessionClick = useCallback((session: SessionWithProvider, projectId: string) => onSessionSelect({ ...session, __projectId: projectId }), [onSessionSelect]);
  const isProjectStarred = useCallback((projectId: string) => resolveStar(projectId), [resolveStar]);
  const getProjectSessions = useCallback((project: Project) => getAllSessions(project), []);

  const toggleStarProject = useCallback((projectId: string) => {
    const oldValue = resolveStar(projectId);
    const requestedValue = !oldValue;
    const requestNumber = (starRequests.current.get(projectId) ?? 0) + 1;
    starRequests.current.set(projectId, requestNumber);
    setStarOverrides((previous) => new Map(previous).set(projectId, requestedValue));
    void (async () => {
      try {
        const response = await api.toggleProjectStar(projectId);
        if (!response.ok) throw new Error(errorMessage(await response.json() as { error?: string | { message?: string } }, t('messages.updateProjectError')));
        const payload = await response.json() as { isStarred?: boolean };
        if (starRequests.current.get(projectId) === requestNumber) setStarOverrides((previous) => new Map(previous).set(projectId, Boolean(payload.isStarred)));
      } catch (error) {
        if (starRequests.current.get(projectId) !== requestNumber) return;
        setStarOverrides((previous) => new Map(previous).set(projectId, oldValue));
        console.error('[Sidebar] Failed to toggle project star:', error);
        alert(t('messages.updateProjectError'));
      }
    })();
  }, [resolveStar, t]);

  const loadMoreSessionsForProject = useCallback(async (projectId: string) => {
    if (!onLoadMoreSessions) return;
    let canStart = false;
    setLoadingMoreProjects((previous) => {
      if (previous.has(projectId)) return previous;
      canStart = true;
      return cloneWith(previous, projectId, true);
    });
    if (!canStart) return;
    try { await onLoadMoreSessions(projectId); }
    catch (error) { console.error('[Sidebar] Failed to load more sessions:', error); alert(t('messages.refreshError')); }
    finally { setLoadingMoreProjects((previous) => cloneWith(previous, projectId, false)); }
  }, [onLoadMoreSessions, t]);

  const filteredProjects = useMemo(() => {
    const resolved = starOverrides.size === 0 ? projects : projects.map((project) => starOverrides.has(project.projectId) && Boolean(project.isStarred) !== starOverrides.get(project.projectId) ? { ...project, isStarred: starOverrides.get(project.projectId) } : project);
    return sortProjects(resolved, projectSortOrder);
  }, [projectSortOrder, projects, starOverrides]);

  const startEditing = useCallback((project: Project) => { setEditingProject(project.projectId); setEditingName(project.displayName); }, []);
  const cancelEditing = useCallback(() => { setEditingProject(null); setEditingName(''); }, []);
  const saveProjectName = useCallback(async (projectId: string) => {
    try {
      const response = await api.renameProject(projectId, editingName);
      if (response.ok) await palette.refreshProjects();
      else console.error('Failed to rename project');
    } catch (error) { console.error('Error renaming project:', error); }
    finally { setEditingProject(null); setEditingName(''); }
  }, [editingName, palette]);

  const showDeleteSessionConfirmation = useCallback((projectId: string | null, sessionId: string, sessionTitle: string, provider: SessionDeleteConfirmation['provider'] = 'gjc', options: { isArchived?: boolean } = {}) => setSessionDeleteConfirmation({ projectId, sessionId, sessionTitle, provider, isArchived: Boolean(options.isArchived) }), []);
  const confirmDeleteSession = useCallback(async (hardDelete = false) => {
    if (!sessionDeleteConfirmation) return;
    const { sessionId } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);
    try {
      const response = await api.deleteSession(sessionId, hardDelete);
      if (!response.ok) { console.error('[Sidebar] Failed to delete session:', { status: response.status, error: await response.text() }); alert(t('messages.deleteSessionFailed')); return; }
      forgetSessionStorage(sessionId);
      onSessionDelete?.(sessionId);
      await fetchArchivedSessions();
    } catch (error) { console.error('[Sidebar] Error deleting session:', error); alert(t('messages.deleteSessionError')); }
  }, [fetchArchivedSessions, onSessionDelete, sessionDeleteConfirmation, t]);

  const requestProjectDelete = useCallback((project: Project) => setDeleteConfirmation({ project, sessionCount: getProjectSessions(project).length }), [getProjectSessions]);
  const confirmDeleteProject = useCallback(async (deleteData = false) => {
    if (!deleteConfirmation) return;
    const project = deleteConfirmation.project;
    setDeleteConfirmation(null);
    setDeletingProjects((previous) => cloneWith(previous, project.projectId, true));
    try {
      const response = await api.deleteProject(project.projectId, deleteData);
      if (response.ok) onProjectDelete?.(project.projectId);
      else alert(errorMessage(await response.json() as { error?: string | { message?: string } }, t('messages.deleteProjectFailed')));
    } catch (error) { console.error('Error deleting project:', error); alert(t('messages.deleteProjectError')); }
    finally { setDeletingProjects((previous) => cloneWith(previous, project.projectId, false)); }
  }, [deleteConfirmation, onProjectDelete, t]);

  const handleProjectSelect = useCallback((project: Project) => onProjectSelect(project), [onProjectSelect]);
  const openArchivedSession = useCallback((session: ArchivedSessionListItem) => {
    const project = session.projectId ? projects.find((candidate) => candidate.projectId === session.projectId) ?? archivedProjects.find((candidate) => candidate.projectId === session.projectId) ?? null : null;
    if (project) handleProjectSelect(project);
    onSessionSelect({ id: session.sessionId, summary: session.sessionTitle, __provider: session.provider, __projectId: project?.projectId ?? session.projectId ?? undefined });
  }, [archivedProjects, handleProjectSelect, onSessionSelect, projects]);

  const restore = useCallback(async (id: string, kind: 'project' | 'session') => {
    try {
      const response = kind === 'project' ? await api.restoreProject(id) : await api.restoreSession(id);
      if (!response.ok) {
        console.error(`[Sidebar] Failed to restore ${kind}:`, { status: response.status, error: await response.text() });
        alert(kind === 'project' ? t('messages.restoreProjectFailed', 'Failed to restore project. Please try again.') : t('messages.restoreSessionFailed', 'Failed to restore session. Please try again.'));
        return;
      }
      await Promise.all([Promise.resolve(onRefresh()), fetchArchivedSessions()]);
    } catch (error) {
      console.error(`[Sidebar] Error restoring ${kind}:`, error);
      alert(kind === 'project' ? t('messages.restoreProjectError', 'Error restoring project. Please try again.') : t('messages.restoreSessionError', 'Error restoring session. Please try again.'));
    }
  }, [fetchArchivedSessions, onRefresh, t]);
  const restoreArchivedProject = useCallback(async (projectId: string) => restore(projectId, 'project'), [restore]);
  const restoreArchivedSession = useCallback(async (sessionId: string) => restore(sessionId, 'session'), [restore]);
  const openArchive = useCallback(() => { setIsArchiveOpen(true); void fetchArchivedSessions(); }, [fetchArchivedSessions]);
  const closeArchive = useCallback(() => setIsArchiveOpen(false), []);
  const refreshProjects = useCallback(async () => { setIsRefreshing(true); try { await Promise.all([Promise.resolve(onRefresh()), fetchArchivedSessions()]); } finally { setIsRefreshing(false); } }, [fetchArchivedSessions, onRefresh]);
  const updateSessionSummary = useCallback(async (_projectId: string, sessionId: string, summary: string, _provider: LLMProvider) => {
    const nextSummary = summary.trim();
    if (!nextSummary) { setEditingSession(null); setEditingSessionName(''); return; }
    try {
      const response = await api.renameSession(sessionId, nextSummary);
      if (response.ok) await onRefresh();
      else { console.error('[Sidebar] Failed to rename session:', response.status); alert(t('messages.renameSessionFailed')); }
    } catch (error) { console.error('[Sidebar] Error renaming session:', error); alert(t('messages.renameSessionError')); }
    finally { setEditingSession(null); setEditingSessionName(''); }
  }, [onRefresh, t]);
  const regenerateSessionTitle = useCallback(async (sessionId: string) => {
    try {
      const response = await api.regenerateSessionTitle(sessionId);
      if (!response.ok) { console.error('[Sidebar] Failed to regenerate session title:', response.status); alert(t('messages.regenerateTitleFailed')); return; }
      await onRefresh();
    } catch (error) { console.error('[Sidebar] Error regenerating session title:', error); alert(t('messages.regenerateTitleFailed')); }
  }, [onRefresh, t]);
  const toggleSessionStar = useCallback(async (sessionId: string) => {
    try {
      const response = await api.toggleSessionStar(sessionId);
      if (!response.ok) { console.error('[Sidebar] Failed to toggle session star:', response.status); alert(t('messages.updateSessionError')); return; }
      await onRefresh();
    } catch (error) { console.error('[Sidebar] Error toggling session star:', error); alert(t('messages.updateSessionError')); }
  }, [onRefresh, t]);
  const exportSession = useCallback(async (sessionId: string) => {
    try {
      const response = await api.exportSession(sessionId);
      if (!response.ok) { console.error('[Sidebar] Failed to export session:', response.status); alert(t('messages.exportSessionError')); return; }
      downloadBlob(await response.blob(), filenameFromContentDisposition(response.headers.get('content-disposition'), `${sessionId}.md`));
    } catch (error) { console.error('[Sidebar] Error exporting session:', error); alert(t('messages.exportSessionError')); }
  }, [t]);
  const collapseSidebar = useCallback(() => setSidebarVisible(false), [setSidebarVisible]);
  const expandSidebar = useCallback(() => setSidebarVisible(true), [setSidebarVisible]);

  return { isSidebarCollapsed: !isMobile && !sidebarVisible, expandedProjects, editingProject, showNewProject, editingName, initialSessionsLoaded, currentTime, projectSortOrder, isRefreshing, editingSession, editingSessionName, deletingProjects, loadingMoreProjects, deleteConfirmation, sessionDeleteConfirmation, filteredProjects, isArchiveOpen, archiveLoadError, archivedProjects, archivedSessions, archivedSessionsCount: archivedProjects.length + archivedSessions.length, isArchivedSessionsLoading, toggleProject, handleSessionClick, toggleStarProject, isProjectStarred, getProjectSessions, loadMoreSessionsForProject, startEditing, cancelEditing, saveProjectName, showDeleteSessionConfirmation, confirmDeleteSession, requestProjectDelete, confirmDeleteProject, handleProjectSelect, openArchivedSession, restoreArchivedProject, restoreArchivedSession, openArchive, closeArchive, refreshProjects, updateSessionSummary, regenerateSessionTitle, toggleSessionStar, exportSession, collapseSidebar, expandSidebar, setShowNewProject, setEditingName, setEditingSession, setEditingSessionName, setDeleteConfirmation, setSessionDeleteConfirmation };
}
