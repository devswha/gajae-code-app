import type { Dispatch, SetStateAction } from 'react';

import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import type { SessionEstablishedContext, SessionNavigationOptions } from '../../chat/types/types';
import type { SettingsMainTab } from '../../settings/types/types';

type TabSetter = Dispatch<SetStateAction<AppTab>>;
export interface MainContentProps {
  activeTab: AppTab; isLoading: boolean; isMobile: boolean; newSessionTrigger: number; processingSessions: SessionActivityMap; selectedProject: Project | null; selectedSession: ProjectSession | null; ws: WebSocket | null;
  onInputFocusChange: (focused: boolean) => void; onMenuClick: () => void; onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void; onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void; onSessionIdle: MarkSessionIdle; onSessionProcessing: MarkSessionProcessing; onShowSettings: (tab?: SettingsMainTab) => void; sendMessage: (message: unknown) => void; setActiveTab: TabSetter;
}

export interface MainContentHeaderProps {
  activeTab: AppTab; isMobile: boolean; selectedProject: Project; selectedSession: ProjectSession | null; workspaceOpen: boolean;
  onMenuClick: () => void; onToggleWorkspace: () => void; setActiveTab: TabSetter;
}

export interface MainContentStateViewProps { isMobile: boolean; mode: 'loading' | 'empty'; onMenuClick: () => void; }
export interface MobileMenuButtonProps { compact?: boolean; onMenuClick: () => void; }
