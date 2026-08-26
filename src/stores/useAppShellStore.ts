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
  attentionSessionIds: Set<string>;
  loadingProgress: LoadingProgress | null;
  setSelectedProject: (next: Updater<Project | null>) => void;
  setSelectedSession: (next: Updater<ProjectSession | null>) => void;
  setActiveTab: (next: Updater<AppTab>) => void;
  setSidebarOpen: (next: Updater<boolean>) => void;
  openSettings: (tab?: string) => void;
  setShowSettings: (next: Updater<boolean>) => void;
  markSessionAttention: (sessionId: string, viewedSessionId: string | null) => void;
  clearSessionAttention: (sessionId: string) => void;
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

const resolve = <T,>(next: T | ((prev: T) => T), prev: T): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;

const createInitialState = (): AppShellState => ({
  selectedProject: null,
  selectedSession: null,
  activeTab: readPersistedTab(),
  sidebarOpen: false,
  showSettings: false,
  settingsInitialTab: 'agents',
  attentionSessionIds: new Set(),
  loadingProgress: null,
  setSelectedProject: () => undefined,
  setSelectedSession: () => undefined,
  setActiveTab: () => undefined,
  setSidebarOpen: () => undefined,
  openSettings: () => undefined,
  setShowSettings: () => undefined,
  markSessionAttention: () => undefined,
  clearSessionAttention: () => undefined,
  setLoadingProgress: () => undefined,
});

export const useAppShellStore = create<AppShellState>()((set) => ({
  ...createInitialState(),
  setSelectedProject: (next) => set((state) => ({
    selectedProject: resolve(next, state.selectedProject),
  })),
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
  markSessionAttention: (sessionId, viewedSessionId) => {
    if (sessionId === viewedSessionId) {
      return;
    }

    set((state) => {
      if (state.attentionSessionIds.has(sessionId)) {
        return state;
      }

      const attentionSessionIds = new Set(state.attentionSessionIds);
      attentionSessionIds.add(sessionId);
      return { attentionSessionIds };
    });
  },
  clearSessionAttention: (sessionId) => set((state) => {
    if (!state.attentionSessionIds.has(sessionId)) {
      return state;
    }

    const attentionSessionIds = new Set(state.attentionSessionIds);
    attentionSessionIds.delete(sessionId);
    return { attentionSessionIds };
  }),
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
    markSessionAttention: useAppShellStore.getState().markSessionAttention,
    clearSessionAttention: useAppShellStore.getState().clearSessionAttention,
    setLoadingProgress: useAppShellStore.getState().setLoadingProgress,
  }, true);
};
