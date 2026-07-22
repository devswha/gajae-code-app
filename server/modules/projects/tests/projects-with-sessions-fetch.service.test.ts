import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { getArchivedProjectsWithSessions, getProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';

type Stubs = {
  getProjectPaths: typeof projectsDb.getProjectPaths;
  getInitialSessionPagesByProject: typeof sessionsDb.getInitialSessionPagesByProject;
};

function withStubs(total: number, run: (captured: { limit?: number }) => Promise<void>): Promise<void> {
  const original: Stubs = {
    getProjectPaths: projectsDb.getProjectPaths,
    getInitialSessionPagesByProject: sessionsDb.getInitialSessionPagesByProject,
  };
  const captured: { limit?: number } = {};
  // custom_project_name is set so getProjectsWithSessions skips filesystem displayName derivation.
  (projectsDb as unknown as { getProjectPaths: () => unknown }).getProjectPaths = () => [
    { project_id: 'p1', project_path: '/ws/p1', custom_project_name: 'p1', isStarred: 0 },
  ];
  (sessionsDb as unknown as { getInitialSessionPagesByProject: (limit: number) => unknown[] })
    .getInitialSessionPagesByProject = (limit) => {
      captured.limit = limit;
      return total > 0
        ? [{
            session_id: 's1',
            provider: 'gjc',
            project_path: '/ws/p1',
            custom_name: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            total,
          }]
        : [];
    };

  return run(captured).finally(() => {
    projectsDb.getProjectPaths = original.getProjectPaths;
    sessionsDb.getInitialSessionPagesByProject = original.getInitialSessionPagesByProject;
  });
}

test('getProjectsWithSessions caps the initial eager session slice at 5 when no limit is given', async () => {
  await withStubs(42, async (captured) => {
    const projects = await getProjectsWithSessions({ skipSynchronization: true });
    assert.equal(captured.limit, 5, 'eager per-project session slice must default to 5');
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionMeta.total, 42, 'total reflects the full session count for lazy-load');
    assert.equal(projects[0].sessionMeta.hasMore, true, 'hasMore lets the frontend lazy-load the rest');
  });
});

test('getProjectsWithSessions respects an explicit sessionsLimit (no forced cap)', async () => {
  await withStubs(42, async (captured) => {
    await getProjectsWithSessions({ skipSynchronization: true, sessionsLimit: 12 });
    assert.equal(captured.limit, 12, 'an explicit sessionsLimit overrides the small default');
  });
});

function withArchivedStubs(total: number, run: (captured: { limit?: number }) => Promise<void>): Promise<void> {
  const original = {
    getArchivedProjectPaths: projectsDb.getArchivedProjectPaths,
    pageFn: sessionsDb.getSessionsByProjectPathIncludingArchivedPage,
    countFn: sessionsDb.countSessionsByProjectPathIncludingArchived,
  };
  const captured: { limit?: number } = {};
  (projectsDb as unknown as { getArchivedProjectPaths: () => unknown }).getArchivedProjectPaths = () => [
    { project_id: 'a1', project_path: '/ws/a1', custom_project_name: 'a1', isStarred: 0 },
  ];
  (sessionsDb as unknown as { getSessionsByProjectPathIncludingArchivedPage: (p: string, l: number, o: number) => unknown[] })
    .getSessionsByProjectPathIncludingArchivedPage = (_p, limit) => { captured.limit = limit; return []; };
  (sessionsDb as unknown as { countSessionsByProjectPathIncludingArchived: () => number })
    .countSessionsByProjectPathIncludingArchived = () => total;

  return run(captured).finally(() => {
    projectsDb.getArchivedProjectPaths = original.getArchivedProjectPaths;
    sessionsDb.getSessionsByProjectPathIncludingArchivedPage = original.pageFn;
    sessionsDb.countSessionsByProjectPathIncludingArchived = original.countFn;
  });
}

test('getArchivedProjectsWithSessions returns a bounded page instead of every session', async () => {
  await withArchivedStubs(100, async (captured) => {
    const projects = await getArchivedProjectsWithSessions({ skipSynchronization: true });
    assert.equal(captured.limit, 20, 'archived sessions are paged (default 20), not returned unbounded');
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionMeta.total, 100, 'total reflects the full preserved history');
    assert.equal(projects[0].sessionMeta.hasMore, true, 'hasMore lets a client page through all archived history');
  });
});

test('getArchivedProjectsWithSessions honors an explicit sessionsLimit', async () => {
  await withArchivedStubs(100, async (captured) => {
    await getArchivedProjectsWithSessions({ skipSynchronization: true, sessionsLimit: 50 });
    assert.equal(captured.limit, 50);
  });
});
