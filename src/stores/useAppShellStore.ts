import { create } from 'zustand';

import type { AppTab, Project, ProjectSession } from '../types/app';

type Updater<T> = T | ((prev: T) => T);

export type AppShellState = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  sidebarOpen: boolean;
  setSelectedProject: (next: Updater<Project | null>) => void;
  setSelectedSession: (next: Updater<ProjectSession | null>) => void;
  setActiveTab: (next: Updater<AppTab>) => void;
  setSidebarOpen: (next: Updater<boolean>) => void;
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
  setSelectedProject: () => undefined,
  setSelectedSession: () => undefined,
  setActiveTab: () => undefined,
  setSidebarOpen: () => undefined,
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
}));

export const resetAppShellStore = () => {
  useAppShellStore.setState({
    ...createInitialState(),
    setSelectedProject: useAppShellStore.getState().setSelectedProject,
    setSelectedSession: useAppShellStore.getState().setSelectedSession,
    setActiveTab: useAppShellStore.getState().setActiveTab,
    setSidebarOpen: useAppShellStore.getState().setSidebarOpen,
  }, true);
};
