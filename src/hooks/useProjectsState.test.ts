import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../types/app';

import { projectsHaveChanges, readProjectsResponse, reconcileSelectedProject } from './useProjectsState';

const autoProject: Project = {
  projectId: 'project-1',
  path: '/workspace/project',
  fullPath: '/workspace/project',
  displayName: 'project',
  origin: 'auto',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

test('projectsHaveChanges detects a user-visible origin promotion', () => {
  assert.equal(projectsHaveChanges(
    [autoProject],
    [{ ...autoProject, origin: 'explicit' }],
  ), true);
});

test('projectsHaveChanges keeps identical project snapshots stable', () => {
  assert.equal(projectsHaveChanges([autoProject], [{ ...autoProject }]), false);
});

test('readProjectsResponse returns the array from an ok response', async () => {
  const response = new Response(JSON.stringify([autoProject]), { status: 200 });

  const projects = await readProjectsResponse(response, 'fetching');

  assert.ok(projects);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectId, 'project-1');
});

test('readProjectsResponse degrades a 401 error payload to null instead of crashing', async () => {
  // Regression: an unauthorized `{"error":"Unauthorized"}` payload used to be
  // cast to Project[] and fed into the merge, throwing "projects is not
  // iterable" inside a React state updater and blanking the whole app.
  const response = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  assert.equal(await readProjectsResponse(response, 'fetching'), null);
});

test('readProjectsResponse rejects ok responses whose body is not an array', async () => {
  const objectBody = new Response(JSON.stringify({ error: 'oops' }), { status: 200 });
  const invalidJson = new Response('not json', { status: 200 });

  assert.equal(await readProjectsResponse(objectBody, 'refreshing'), null);
  assert.equal(await readProjectsResponse(invalidJson, 'refreshing'), null);
});

test('reconcileSelectedProject applies refreshed display metadata to the active project', () => {
  const renamedProject = { ...autoProject, displayName: 'Renamed project' };

  const reconciled = reconcileSelectedProject(autoProject, [renamedProject]);

  assert.equal(reconciled?.displayName, 'Renamed project');
});

test('reconcileSelectedProject preserves expanded session pages during metadata refresh', () => {
  const loadedProject: Project = {
    ...autoProject,
    sessions: [
      { id: 'session-1', summary: 'First' },
      { id: 'session-2', summary: 'Second' },
    ],
    sessionMeta: { hasMore: false, total: 2 },
  };
  const renamedProject: Project = {
    ...autoProject,
    displayName: 'Renamed project',
    sessions: [{ id: 'session-1', summary: 'First' }],
    sessionMeta: { hasMore: true, total: 2 },
  };

  const reconciled = reconcileSelectedProject(loadedProject, [renamedProject]);

  assert.equal(reconciled?.displayName, 'Renamed project');
  assert.deepEqual(reconciled?.sessions?.map((session) => session.id), ['session-1', 'session-2']);
});
