import { create } from 'zustand';

import type { LoadingProgress, Project, ProjectSession } from '../types/app';

type Updater<T> = T | ((prev: T) => T);

export type AppShellState = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  sidebarOpen: boolean;
  showSettings: boolean;
  settingsInitialTab: string;
  loadingProgress: LoadingProgress | null;
  /** The add-project dialog; opened from the sidebar and from the empty main pane alike. */
  newProjectOpen: boolean;
  /**
   * Set when a `/handoff` gate is confirmed. The runtime reports the successor
   * session it moved to, and only the upsert carrying that provider session id
   * is followed: "the next session in this project" used to steal the window
   * for any third session that happened to appear first.
   */
  pendingHandoff: { fromSessionId: string | null; projectId: string | undefined; at: number; providerSessionId?: string } | null;
  setSelectedProject: (next: Updater<Project | null>) => void;
  setSelectedSession: (next: Updater<ProjectSession | null>) => void;
  setSidebarOpen: (next: Updater<boolean>) => void;
  openSettings: (tab?: string) => void;
  setShowSettings: (next: Updater<boolean>) => void;
  setLoadingProgress: (next: Updater<LoadingProgress | null>) => void;
  setNewProjectOpen: (next: Updater<boolean>) => void;
  setPendingHandoff: (next: AppShellState['pendingHandoff']) => void;
};

const SELECTED_PROJECT_KEY = 'selectedProjectId';

/**
 * The project the user last worked in. `/session/:id` restores its own
 * context from the URL; this is what lets `/` come back to the same project
 * after a reload instead of the empty "pick a project" state.
 */
export const readPersistedProjectId = (): string | null => {
  try {
    return localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
};

const persistProjectId = (projectId: string | null) => {
  try {
    if (projectId) {
      localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
  } catch {
    // Silently ignore storage errors
  }
};

const resolve = <T,>(next: T | ((prev: T) => T), prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;

const createInitialState = (): AppShellState => ({
  selectedProject: null,
  selectedSession: null,
  sidebarOpen: false,
  showSettings: false,
  settingsInitialTab: 'agents',
  loadingProgress: null,
  newProjectOpen: false,
  pendingHandoff: null,
  setSelectedProject: () => undefined,
  setSelectedSession: () => undefined,
  setSidebarOpen: () => undefined,
  openSettings: () => undefined,
  setShowSettings: () => undefined,
  setLoadingProgress: () => undefined,
  setNewProjectOpen: () => undefined,
  setPendingHandoff: () => undefined,
});

export const useAppShellStore = create<AppShellState>()((set) => ({
  ...createInitialState(),
  setSelectedProject: (next) => set((state) => {
    const selectedProject = resolve(next, state.selectedProject);
    // Reconciliation re-sets the same project on every fetch; only a change
    // of project is worth a storage write.
    const projectId = selectedProject?.projectId ?? null;
    if (projectId !== (state.selectedProject?.projectId ?? null)) persistProjectId(projectId);
    return { selectedProject };
  }),
  setSelectedSession: (next) => set((state) => ({
    selectedSession: resolve(next, state.selectedSession),
  })),
  setSidebarOpen: (next) => set((state) => ({
    sidebarOpen: resolve(next, state.sidebarOpen),
  })),
  openSettings: (tab = 'tools') => set({
    settingsInitialTab: tab,
    showSettings: true,
  }),
  setShowSettings: (next) => set((state) => ({
    showSettings: resolve(next, state.showSettings),
  })),
  setLoadingProgress: (next) => set((state) => ({
    loadingProgress: resolve(next, state.loadingProgress),
  })),
  setNewProjectOpen: (next) => set((state) => ({
    newProjectOpen: resolve(next, state.newProjectOpen),
  })),
  setPendingHandoff: (next) => set({ pendingHandoff: next }),
}));

export const resetAppShellStore = () => {
  useAppShellStore.setState({
    ...createInitialState(),
    setSelectedProject: useAppShellStore.getState().setSelectedProject,
    setSelectedSession: useAppShellStore.getState().setSelectedSession,
    setSidebarOpen: useAppShellStore.getState().setSidebarOpen,
    openSettings: useAppShellStore.getState().openSettings,
    setShowSettings: useAppShellStore.getState().setShowSettings,
    setLoadingProgress: useAppShellStore.getState().setLoadingProgress,
    setNewProjectOpen: useAppShellStore.getState().setNewProjectOpen,
    setPendingHandoff: useAppShellStore.getState().setPendingHandoff,
  }, true);
};
