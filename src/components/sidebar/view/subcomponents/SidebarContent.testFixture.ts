import type { Project } from '../../../../types/app';

export const sidebarProjectsFixture: Project[] = [
  {
    projectId: 'project-alpha',
    displayName: 'Alpha Workspace',
    fullPath: '/work/alpha',
    sessions: [
      {
        id: 'session-running',
        summary: 'Implement navigation cleanup',
        created_at: '2026-07-21T10:00:00.000Z',
        lastActivity: '2026-07-21T10:15:00.000Z',
        messageCount: 3,
        __provider: 'gjc',
      },
    ],
    sessionMeta: { total: 1 },
  },
  {
    projectId: 'project-beta',
    displayName: 'Beta Workspace',
    fullPath: '/work/beta',
    sessions: [
      {
        id: 'session-attention',
        summary: 'Review pending decision',
        created_at: '2026-07-21T09:00:00.000Z',
        lastActivity: '2026-07-21T09:30:00.000Z',
        messageCount: 1,
        __provider: 'claude',
      },
    ],
    sessionMeta: { total: 1 },
  },
];
