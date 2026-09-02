import { compareSessionStatus, type SessionStatus } from '../../../stores/sessionStatusModel';
import type { Project } from '../../../types/app';
import type { SessionStatusResolver } from '../hooks/useSessionStatusResolver';
import type { SessionWithProvider } from '../types/types';

export type WorkRow = { project: Project; session: SessionWithProvider; status: SessionStatus };

type WorkListSource = {
  filteredProjects: Project[];
  getProjectSessions: (project: Project) => SessionWithProvider[];
  getSessionStatus: SessionStatusResolver;
};

function sessionTimestamp(session: SessionWithProvider): number {
  const value = session.lastActivity ?? session.updated_at ?? session.createdAt ?? session.created_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * The Work section: every session across every project that is not idle,
 * ordered by what the user should look at first - a question before a
 * failure before a finished run before something still working - then pinned
 * rows ahead of the rest, then newest first.
 */
export function collectWorkRows({ filteredProjects, getProjectSessions, getSessionStatus }: WorkListSource): WorkRow[] {
  return filteredProjects
    .flatMap((project) => getProjectSessions(project).map((session) => ({ project, session, status: getSessionStatus(session.id) })))
    .filter((row) => row.status !== 'idle')
    .sort((a, b) => (
      compareSessionStatus(a.status, b.status)
      || Number(Boolean(b.session.isStarred)) - Number(Boolean(a.session.isStarred))
      || sessionTimestamp(b.session) - sessionTimestamp(a.session)
    ));
}

export type WorkCounts = Record<Exclude<SessionStatus, 'idle'>, number>;

export function countWorkRows(rows: readonly WorkRow[]): WorkCounts {
  const counts: WorkCounts = { needs_input: 0, blocked: 0, ready: 0, running: 0 };
  for (const row of rows) {
    if (row.status !== 'idle') counts[row.status] += 1;
  }
  return counts;
}
