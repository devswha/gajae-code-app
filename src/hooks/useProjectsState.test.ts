import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../types/app';

import { projectsHaveChanges } from './useProjectsState';

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
