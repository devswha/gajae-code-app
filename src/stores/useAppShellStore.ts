import { create } from 'zustand';

import type { AppTab, LoadingProgress, Project, ProjectSession } from '../types/app';

type Updater<T> = T | ((prev: T) => T);

export type AppShellState = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  sidebarOpen: boolean;
  showSettings: boolean;
  settingsInitialTab: string;
  loadingProgress: LoadingProgress | null;
  setSelectedProject: (next: Updater<Project | null>) => void;
  setSelectedSession: (next: Updater<ProjectSession | null>) => void;
  setActiveTab: (next: Updater<AppTab>) => void;
  setSidebarOpen: (next: Updater<boolean>) => void;
  openSettings: (tab?: string) => void;
  setShowSettings: (next: Updater<boolean>) => void;
  setLoadingProgress: (next: Updater<LoadingProgress | null>) => void;
};

// 'shell'/'git'/'files' were removed as tabs (Files is a side panel now);
// persisted selections fall back to 'chat' via isValidTab.
const VALID_TABS: Set<string> = new Set(['chat', 'tasks', 'browser']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
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
  activeTab: readPersistedTab(),
  sidebarOpen: false,
  showSettings: false,
  settingsInitialTab: 'agents',
  loadingProgress: null,
  setSelectedProject: () => undefined,
  setSelectedSession: () => undefined,
  setActiveTab: () => undefined,
  setSidebarOpen: () => undefined,
  openSettings: () => undefined,
  setShowSettings: () => undefined,
  setLoadingProgress: () => undefined,
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
  setActiveTab: (next) => set((state) => {
    const activeTab = resolve(next, state.activeTab);
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
    return { activeTab };
  }),
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
}));

export const resetAppShellStore = () => {
  useAppShellStore.setState({
    ...createInitialState(),
    setSelectedProject: useAppShellStore.getState().setSelectedProject,
    setSelectedSession: useAppShellStore.getState().setSelectedSession,
    setActiveTab: useAppShellStore.getState().setActiveTab,
    setSidebarOpen: useAppShellStore.getState().setSidebarOpen,
    openSettings: useAppShellStore.getState().openSettings,
    setShowSettings: useAppShellStore.getState().setShowSettings,
    setLoadingProgress: useAppShellStore.getState().setLoadingProgress,
  }, true);
};
