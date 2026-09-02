import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';

import { filterSessions, normalizeFilterQuery } from './sessionFilter';

const session = (id: string, summary: string): SessionWithProvider => ({ id, summary, __provider: 'gjc' });

const projects: Project[] = [
  { projectId: 'web', displayName: 'Web App', fullPath: '/web', sessions: [session('w1', 'Fix login redirect'), session('w2', 'Add dark mode')] },
  { projectId: 'api', displayName: 'Payments API', fullPath: '/api', sessions: [session('a1', 'Retry webhook delivery'), session('a2', 'Untitled')] },
  { projectId: 'empty', displayName: 'Docs', fullPath: '/docs', sessions: [] },
];

const getProjectSessions = (project: Project) => (project.sessions ?? []) as SessionWithProvider[];
const run = (query: string, messageMatchIds: string[] = []) => filterSessions({ query, projects, getProjectSessions, messageMatchIds: new Set(messageMatchIds) });

test('an empty or blank query leaves the tree untouched', () => {
  for (const query of ['', '   ']) {
    const result = run(query);
    assert.equal(result.active, false);
    assert.equal(result.projects, projects, 'the same array, so nothing re-renders');
    assert.equal(result.sessionsFor, getProjectSessions);
  }
  assert.equal(normalizeFilterQuery('  Login '), 'login');
});

test('sessions match on title regardless of case and projects with no hits disappear', () => {
  const result = run('LOGIN');
  assert.equal(result.active, true);
  assert.deepEqual(result.projects.map((project) => project.projectId), ['web']);
  assert.deepEqual(result.sessionsFor(projects[0]).map((entry) => entry.id), ['w1']);
  assert.equal(result.sessionCount, 1);
});

test('a body match found by the server surfaces the session even when its title says nothing', () => {
  const result = run('stripe', ['a2']);
  assert.deepEqual(result.projects.map((project) => project.projectId), ['api']);
  assert.deepEqual(result.sessionsFor(projects[1]).map((entry) => entry.id), ['a2']);
});

test('a project whose name matches keeps every session, so the user can browse it', () => {
  const result = run('payments');
  assert.deepEqual(result.projects.map((project) => project.projectId), ['api']);
  assert.deepEqual(result.sessionsFor(projects[1]).map((entry) => entry.id), ['a1', 'a2']);
  assert.equal(result.sessionCount, 2);

  const emptyProject = run('docs');
  assert.deepEqual(emptyProject.projects.map((project) => project.projectId), ['empty'], 'a matching name shows even an empty project');
  assert.equal(emptyProject.sessionCount, 0);
});

test('hits across projects are all kept, each under its own project', () => {
  const result = run('re', ['w2']);
  assert.deepEqual(result.projects.map((project) => project.projectId), ['web', 'api']);
  assert.deepEqual(result.sessionsFor(projects[0]).map((entry) => entry.id), ['w1', 'w2']);
  assert.deepEqual(result.sessionsFor(projects[1]).map((entry) => entry.id), ['a1']);
  assert.deepEqual(result.sessionsFor(projects[2]), []);
});
