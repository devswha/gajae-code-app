import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

import type { Project, ProjectSession } from '../../../types/app';

import SidebarContent from './SidebarContent';
import { makeSidebarT, sidebarContentPropsFixture, sidebarProjectsFixture } from './SidebarContent.testFixture';

/*
 * A running conversation is listed twice: in Work and under its workspace.
 * Exactly one row may look selected, and it is the one the user clicked.
 */

afterEach(cleanup);

function Harness({ t, initial }: { t: TFunction; initial: ProjectSession | null }) {
  const base = sidebarContentPropsFixture(t);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(initial);
  const [selectedProject, setSelectedProject] = useState<Project | null>(initial ? sidebarProjectsFixture[0] : null);
  return (
    <MemoryRouter>
      <SidebarContent
        {...base}
        projectListProps={{
          ...base.projectListProps,
          selectedSession,
          selectedProject,
          onSessionSelect: (session) => setSelectedSession(session),
          onProjectSelect: (project) => setSelectedProject(project),
        }}
      />
    </MemoryRouter>
  );
}

const TITLE = 'Implement navigation cleanup';

/** Where each highlighted row lives: `work` or `tree`. */
function highlighted(): string[] {
  return Array.from(document.querySelectorAll('[data-session-status]'))
    .filter((row) => row.classList.contains('bg-accent'))
    .map((row) => (row.closest('#sidebar-work-content') ? 'work' : 'tree'));
}

const rowLink = (where: 'work' | 'tree') => screen.getAllByRole('link', { name: TITLE })
  .find((link) => Boolean(link.closest('#sidebar-work-content')) === (where === 'work'))!;

test('only the list the conversation was picked from shows it selected', async () => {
  const t = await makeSidebarT();
  render(<Harness t={t} initial={null} />);
  assert.equal(screen.getAllByRole('link', { name: TITLE }).length, 2, 'listed in Work and in the tree');

  fireEvent.click(rowLink('work'));
  assert.deepEqual(highlighted(), ['work']);

  fireEvent.click(rowLink('tree'));
  assert.deepEqual(highlighted(), ['tree']);
});

test('a selection from elsewhere belongs to the tree, and the workspace row stays plain', async () => {
  const t = await makeSidebarT();
  const session = { ...sidebarProjectsFixture[0].sessions![0], __provider: 'gjc' as const };
  render(<Harness t={t} initial={session} />);

  assert.deepEqual(highlighted(), ['tree']);
  const workspaceRow = screen.getByRole('button', { name: /Alpha Workspace/ });
  assert.equal(workspaceRow.classList.contains('bg-accent'), false, 'a folder is not a second selection');
});
