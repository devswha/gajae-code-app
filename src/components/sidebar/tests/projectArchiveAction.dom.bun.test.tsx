import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';

import enSidebar from '../../../i18n/locales/en/sidebar.json';
import type { Project } from '../../../types/app';
import { useSidebarController } from '../hooks/useSidebarController';
import SidebarProjectItem from '../view/SidebarProjectItem';

/*
 * The project row's removal action.
 *
 * A project can only be archived: the request is the archive endpoint, nothing
 * on the row offers deletion, and the app never issues a DELETE for a project -
 * a misclick has to be undoable from the archive screen.
 */

const project: Project = {
  projectId: 'alpha',
  displayName: 'Alpha workspace',
  fullPath: '/workspaces/alpha',
  sessions: [],
  sessionMeta: { total: 0 },
};

// The controller resets per-project state whenever the list identity changes, so
// the harness has to hand it the same array on every render.
const projects = [project];

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

function installFetch(): string[] {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    requests.push(`${init.method ?? 'GET'} ${url}`);
    if (url === '/api/projects/archived') return Response.json({ success: true, data: { projects: [] } });
    if (url === '/api/providers/sessions/archived') return Response.json({ success: true, data: { sessions: [] } });
    return Response.json({ success: true, data: { projectId: 'alpha', isArchived: true } });
  }) as typeof globalThis.fetch;
  return requests;
}

function Harness({ onArchived }: { onArchived: (projectId: string) => void }) {
  const { t } = useTranslation(['sidebar']);
  const controller = useSidebarController({
    projects,
    selectedProject: null,
    selectedSession: null,
    isLoading: false,
    isMobile: false,
    t,
    onRefresh: () => {},
    onProjectSelect: () => {},
    onSessionSelect: () => {},
    onProjectArchive: onArchived,
    setSidebarVisible: () => {},
    sidebarVisible: true,
  });

  return (
    <SidebarProjectItem
      project={project}
      selectedProject={null}
      selectedSession={null}
      isExpanded={false}
      isMobile={false}
      showSessions={false}
      isArchiving={controller.archivingProjects.has(project.projectId)}
      isStarred={false}
      editingProject={null}
      editingName=""
      sessions={[]}
      initialSessionsLoaded
      isLoadingMoreSessions={false}
      currentTime={new Date('2026-09-16T00:00:00.000Z')}
      editingSession={null}
      editingSessionName=""
      onEditingNameChange={() => {}}
      onToggleProject={() => {}}
      onProjectSelect={() => {}}
      onToggleStarProject={() => {}}
      onStartEditingProject={() => {}}
      onCancelEditingProject={() => {}}
      onSaveProjectName={() => {}}
      onArchiveProject={(target) => { void controller.archiveProject(target); }}
      onSessionSelect={() => {}}
      onDeleteSession={() => {}}
      onLoadMoreSessions={() => {}}
      activeSessions={new Map()}
      getSessionStatus={() => 'idle'}
      onNewSession={() => {}}
      onEditingSessionNameChange={() => {}}
      onStartEditingSession={() => {}}
      onCancelEditingSession={() => {}}
      onSaveEditingSession={() => {}}
      t={t}
    />
  );
}

async function setup(): Promise<{ requests: string[]; archived: string[] }> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'sidebar',
    interpolation: { escapeValue: false },
    resources: { en: { sidebar: enSidebar } },
  });
  const requests = installFetch();
  const archived: string[] = [];
  render(
    <I18nextProvider i18n={i18n}>
      <Harness onArchived={(projectId) => archived.push(projectId)} />
    </I18nextProvider>,
  );
  return { requests, archived };
}

test('the row offers archiving and nothing that deletes the workspace', async () => {
  await setup();

  // The unlabelled button is the row itself; the labelled ones are its actions.
  const labels = screen.getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
    .filter((label): label is string => label !== null);
  assert.deepEqual(labels, [
    enSidebar.tooltips.createSession,
    enSidebar.tooltips.addToFavorites,
    enSidebar.tooltips.renameProject,
    enSidebar.tooltips.archiveProject,
  ]);
  // The workspace delete button was the row's only destructive affordance.
  assert.equal(document.body.innerHTML.includes('text-destructive'), false);
});

test('archiving a project posts the archive request and never a delete', async () => {
  const { requests, archived } = await setup();

  fireEvent.click(screen.getByLabelText(enSidebar.tooltips.archiveProject));

  await waitFor(() => assert.deepEqual(archived, ['alpha']));
  assert.ok(requests.includes('POST /api/projects/alpha/archive'), requests.join('\n'));
  assert.deepEqual(requests.filter((request) => request.startsWith('DELETE')), []);
  // The archive screen has to show the project the moment it disappears here.
  await waitFor(() => assert.ok(requests.includes('GET /api/projects/archived')));
});
