import type { TFunction } from 'i18next';

import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type { ProjectSortOrder, SettingsProject, SessionViewModel, SessionWithProvider } from '../types/types';

const settingsKey = 'claude-settings';
const legacyStarsKey = 'starredProjects';

const readStorageJson = (key: string): unknown => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const sessionTimestamp = (session: SessionWithProvider) => String(session.lastActivity || session.createdAt || session.created_at || '');

const providerFor = (session: ProjectSession): LLMProvider => {
  const candidate = session.__provider ?? session.provider;
  return typeof candidate === 'string' && candidate.trim() ? candidate as LLMProvider : 'gjc';
};

export const readProjectSortOrder = (): ProjectSortOrder => {
  const settings = readStorageJson(settingsKey);
  return typeof settings === 'object' && settings !== null && (settings as { projectSortOrder?: unknown }).projectSortOrder === 'date' ? 'date' : 'name';
};

export const readLegacyStarredProjectIds = (): string[] => {
  const saved = readStorageJson(legacyStarsKey);
  return Array.isArray(saved) ? saved.map((item) => String(item).trim()).filter(Boolean) : [];
};

export const clearLegacyStarredProjectIds = () => {
  try {
    localStorage.removeItem(legacyStarsKey);
  } catch {
    // Storage access is optional in embedded browser contexts.
  }
};

const getSessionTime = (session: SessionWithProvider): string => sessionTimestamp(session);

const getSessionDate = (session: SessionWithProvider): Date => new Date(sessionTimestamp(session) || 0);

const getSessionName = (session: SessionWithProvider, t: TFunction): string => session.summary || session.name || t('projects.newSession');

export const createSessionViewModel = (session: SessionWithProvider, currentTime: Date, t: TFunction): SessionViewModel => ({
  isActive: Math.floor((currentTime.getTime() - getSessionDate(session).getTime()) / 60_000) < 10,
  sessionName: getSessionName(session, t),
  sessionTime: getSessionTime(session),
  messageCount: Number(session.messageCount || 0),
});

export const getAllSessions = (project: Project): SessionWithProvider[] => {
  const entries = project.sessions ?? [];
  return entries.map((entry) => ({ ...entry, __provider: providerFor(entry) })).sort((first, second) => getSessionDate(second).getTime() - getSessionDate(first).getTime());
};

const getProjectLastActivity = (project: Project): Date => {
  let newest = new Date(0);
  for (const session of getAllSessions(project)) {
    const timestamp = getSessionDate(session);
    if (timestamp > newest) newest = timestamp;
  }
  return newest;
};

export const sortProjects = (projects: Project[], projectSortOrder: ProjectSortOrder): Project[] => projects.slice().sort((left, right) => {
  const starDifference = Number(Boolean(right.isStarred)) - Number(Boolean(left.isStarred));
  if (starDifference) return starDifference;
  if (projectSortOrder === 'date') return getProjectLastActivity(right).getTime() - getProjectLastActivity(left).getTime();
  return (left.displayName || left.projectId).localeCompare(right.displayName || right.projectId);
});

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fullPath = typeof project.fullPath === 'string' && project.fullPath.length > 0 ? project.fullPath : typeof project.path === 'string' ? project.path : '';
  const path = typeof project.path === 'string' && project.path.length > 0 ? project.path : fullPath;
  return { name: project.projectId, displayName: typeof project.displayName === 'string' && project.displayName.trim().length > 0 ? project.displayName : project.projectId, fullPath, path };
};
