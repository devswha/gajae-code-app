import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date';
export type ArchivedProjectListItem = Project & { isArchived: true };
export type SessionWithProvider = ProjectSession & { __provider: LLMProvider };
export type ArchivedSessionListItem = { sessionId: string; provider: LLMProvider; projectId: string | null; projectPath: string | null; projectDisplayName: string; sessionTitle: string; createdAt: string | null; updatedAt: string | null; lastActivity: string | null; isProjectArchived: boolean };
export type DeleteProjectConfirmation = { project: Project; sessionCount: number };
export type SessionDeleteConfirmation = { projectId: string | null; sessionId: string; sessionTitle: string; provider: LLMProvider; isArchived: boolean };
export type SidebarProps = { activeSessions: SessionActivityMap; onProjectSelect: (project: Project) => void; onSessionSelect: (session: ProjectSession) => void; onNewSession: (project: Project) => void; onSessionDelete?: (sessionId: string) => void; onLoadMoreSessions?: (projectId: string) => Promise<void> | void; onProjectDelete?: (projectId: string) => void; onRefresh: () => Promise<void> | void; isMobile: boolean };
export type SessionViewModel = { isActive: boolean; sessionName: string; sessionTime: string; messageCount: number };
export type SettingsProject = { name: string; displayName: string; fullPath: string; path?: string };
