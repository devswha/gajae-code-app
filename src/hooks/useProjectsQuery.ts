import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../utils/api';
import type { Project, ProjectSession } from '../types/app';

export const PROJECTS_QUERY_KEY = ['projects'] as const;

const serialize = (value: unknown) => JSON.stringify(value ?? null);

/**
 * Read `/api/projects` defensively. An auth failure or error payload here must
 * degrade to "keep the previous project list" — feeding a non-array (e.g.
 * `{"error":"Unauthorized"}`) into the project merge throws inside a React
 * state updater and unmounts the whole app shell to a blank screen.
 */
export const readProjectsResponse = async (
  response: Response,
  action: string,
): Promise<Project[] | null> => {
  if (!response.ok) {
    console.error(`Error ${action} projects: HTTP ${response.status}`);
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) {
    console.error(`Error ${action} projects: response is not a project array`);
    return null;
  }

  return payload as Project[];
};

export const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    return (
      nextProject.projectId !== prevProject.projectId ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      nextProject.origin !== prevProject.origin ||
      Boolean(nextProject.isStarred) !== Boolean(prevProject.isStarred) ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return project.sessions ?? [];
};

const countLoadedProjectSessions = (project: Project): number => getProjectSessions(project).length;

const mergeSessionProviderLists = (baseSessions: ProjectSession[], additionalSessions: ProjectSession[]): ProjectSession[] => {
  const merged = [...baseSessions];
  const seenSessionIds = new Set(baseSessions.map((session) => String(session.id)));

  for (const session of additionalSessions) {
    const sessionId = String(session.id);
    if (seenSessionIds.has(sessionId)) {
      continue;
    }

    merged.push(session);
    seenSessionIds.add(sessionId);
  }

  return merged;
};

export const mergeExpandedSessionPages = (previousProjects: Project[], incomingProjects: Project[]): Project[] => {
  if (previousProjects.length === 0) {
    return incomingProjects;
  }

  const previousByProjectId = new Map(previousProjects.map((project) => [project.projectId, project]));

  return incomingProjects.map((incomingProject) => {
    const previousProject = previousByProjectId.get(incomingProject.projectId);
    if (!previousProject) {
      return incomingProject;
    }

    const previousLoadedCount = countLoadedProjectSessions(previousProject);
    const incomingLoadedCount = countLoadedProjectSessions(incomingProject);
    if (previousLoadedCount <= incomingLoadedCount) {
      return incomingProject;
    }

    const mergedProject: Project = {
      ...incomingProject,
      sessions: mergeSessionProviderLists(incomingProject.sessions ?? [], previousProject.sessions ?? []),
    };

    const totalSessions = Number(incomingProject.sessionMeta?.total ?? previousLoadedCount);
    mergedProject.sessionMeta = {
      ...incomingProject.sessionMeta,
      total: totalSessions,
      hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
    };

    return mergedProject;
  });
};

export function useProjectsQuery() {
  const client = useQueryClient();
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    // A refetch returns the first page of each project's sessions; pages the
    // user expanded are merged back here, on the fetch path only. Doing it in
    // `structuralSharing` applied the same union to every cache write, so a
    // session removed with `setQueryData` (delete, archive) came straight
    // back from the previous list until the next reload.
    queryFn: async () => {
      const data = await readProjectsResponse(await api.projects(), 'fetching');
      if (data === null) {
        throw new Error('projects fetch degraded');
      }
      return mergeExpandedSessionPages(client.getQueryData<Project[]>(PROJECTS_QUERY_KEY) ?? [], data);
    },
    structuralSharing: (oldData, newData) => {
      const previous = (oldData as Project[] | undefined) ?? [];
      const next = newData as Project[];
      if (previous.length === 0) {
        return next;
      }
      return projectsHaveChanges(previous, next) ? next : previous;
    },
  });
}
