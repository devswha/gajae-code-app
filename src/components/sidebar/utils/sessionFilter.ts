import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';

export type SessionFilterInput = {
  query: string;
  projects: Project[];
  getProjectSessions: (project: Project) => SessionWithProvider[];
  /** Sessions whose message bodies matched, from the server-side search. */
  messageMatchIds: ReadonlySet<string>;
};

export type SessionFilterResult = {
  /** Trimmed, lower-cased query; empty when the filter is inactive. */
  needle: string;
  active: boolean;
  projects: Project[];
  sessionsFor: (project: Project) => SessionWithProvider[];
  sessionCount: number;
};

export const normalizeFilterQuery = (query: string): string => query.trim().toLocaleLowerCase();

const sessionTitle = (session: SessionWithProvider): string => String(session.summary || session.name || session.title || '');

const contains = (haystack: string, needle: string) => haystack.toLocaleLowerCase().includes(needle);

/**
 * Narrows the project tree to what matches the query.
 *
 * A session matches on its title or because the server found the words in its
 * messages. A project whose own name matches keeps all of its sessions, since
 * the user is evidently looking for the project. Projects with nothing left
 * to show are dropped entirely.
 */
export function filterSessions({ query, projects, getProjectSessions, messageMatchIds }: SessionFilterInput): SessionFilterResult {
  const needle = normalizeFilterQuery(query);
  if (!needle) {
    return { needle, active: false, projects, sessionsFor: getProjectSessions, sessionCount: 0 };
  }

  const kept = new Map<string, SessionWithProvider[]>();
  const matchedProjects: Project[] = [];
  let sessionCount = 0;
  for (const project of projects) {
    const sessions = getProjectSessions(project);
    const projectMatches = contains(project.displayName || project.projectId, needle);
    const matching = projectMatches
      ? sessions
      : sessions.filter((session) => messageMatchIds.has(session.id) || contains(sessionTitle(session), needle));
    if (!projectMatches && matching.length === 0) continue;
    kept.set(project.projectId, matching);
    matchedProjects.push(project);
    sessionCount += matching.length;
  }

  return {
    needle,
    active: true,
    projects: matchedProjects,
    sessionsFor: (project) => kept.get(project.projectId) ?? [],
    sessionCount,
  };
}
