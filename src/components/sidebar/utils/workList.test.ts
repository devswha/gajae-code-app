import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionStatus } from '../../../stores/sessionStatusModel';
import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';

import { collectWorkRows, countWorkRows } from './workList';

const session = (id: string, lastActivity: string, isStarred = false): SessionWithProvider => ({ id, lastActivity, isStarred, __provider: 'gjc' });

const projects: Project[] = [
  {
    projectId: 'alpha',
    displayName: 'Alpha',
    fullPath: '/alpha',
    sessions: [
      session('a-running-new', '2026-09-02T10:00:00.000Z'),
      session('a-ready', '2026-09-02T09:00:00.000Z'),
      session('a-idle', '2026-09-02T12:00:00.000Z'),
    ],
  },
  {
    projectId: 'beta',
    displayName: 'Beta',
    fullPath: '/beta',
    sessions: [
      session('b-running-old', '2026-09-02T08:00:00.000Z'),
      session('b-running-pinned-old', '2026-09-02T07:00:00.000Z', true),
      session('b-blocked', '2026-09-02T06:00:00.000Z'),
      session('b-needs-input', '2026-09-01T00:00:00.000Z'),
    ],
  },
];

const statuses: Record<string, SessionStatus> = {
  'a-running-new': 'running',
  'a-ready': 'ready',
  'b-running-old': 'running',
  'b-running-pinned-old': 'running',
  'b-blocked': 'blocked',
  'b-needs-input': 'needs_input',
};

const source = {
  filteredProjects: projects,
  getProjectSessions: (project: Project) => (project.sessions ?? []) as SessionWithProvider[],
  getSessionStatus: (sessionId: string) => statuses[sessionId] ?? 'idle',
};

test('Work gathers non-idle sessions across projects, urgency first, pinned first within a state, then newest', () => {
  const rows = collectWorkRows(source);

  assert.deepEqual(rows.map((row) => row.session.id), [
    'b-needs-input',
    'b-blocked',
    'a-ready',
    'b-running-pinned-old',
    'a-running-new',
    'b-running-old',
  ]);
  assert.deepEqual(rows.map((row) => row.project.projectId), ['beta', 'beta', 'alpha', 'beta', 'alpha', 'beta']);
  assert.ok(rows.every((row) => row.status !== 'idle'));
});

test('counts report each state separately and stay at zero for absent ones', () => {
  assert.deepEqual(countWorkRows(collectWorkRows(source)), { needs_input: 1, blocked: 1, ready: 1, running: 3 });
  assert.deepEqual(countWorkRows([]), { needs_input: 0, blocked: 0, ready: 0, running: 0 });
});
