import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance, type TFunction } from 'i18next';

import SidebarArchiveContent from '../view/subcomponents/SidebarArchiveContent';

/*
 * Bulk archiving from the archive screen.
 *
 * The safety property is that the commit button cannot appear before the user
 * has been told how many sessions it will take. Everything else about this
 * control is cosmetic; that one rule is what keeps a single click from
 * archiving an unknown number of sessions.
 */

async function makeT(): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: { en: { sidebar: {} } },
  });
  return i18n.getFixedT(null, 'sidebar');
}

function render(
  t: TFunction,
  overrides: Partial<ComponentProps<typeof SidebarArchiveContent>> = {},
): string {
  return renderToStaticMarkup(
    createElement(SidebarArchiveContent, {
      archivedProjects: [],
      archivedSessions: [],
      archivedSessionsCount: 0,
      isArchivedSessionsLoading: false,
      archiveLoadError: null,
      onRetry: () => undefined,
      onCloseArchive: () => undefined,
      onRestoreArchivedProject: () => undefined,
      onArchivedSessionClick: () => undefined,
      onRestoreArchivedSession: () => undefined,
      onDeleteArchivedSession: () => undefined,
      t,
      ...overrides,
    }),
  );
}

const populated: Partial<ComponentProps<typeof SidebarArchiveContent>> = {
  archivedSessionsCount: 1,
  archivedSessions: [{
    sessionId: 'session-1',
    provider: 'gjc',
    projectId: 'project-1',
    projectPath: '/repos/one',
    projectDisplayName: 'one',
    sessionTitle: 'Archived session',
    createdAt: null,
    updatedAt: null,
    lastActivity: null,
    isProjectArchived: false,
  }],
};

test('the cleanup control is reachable whether or not anything is archived yet', async () => {
  const t = await makeT();

  // The empty archive is exactly where a user with hundreds of active
  // sessions arrives first, so hiding the control there would hide it from
  // the people who need it.
  for (const [label, overrides] of [['empty', {}], ['populated', populated]] as const) {
    const html = render(t, overrides);
    assert.match(html, /Archive sessions idle for/, `${label} archive view`);
  }
});

test('it offers a check before it offers to archive anything', async () => {
  const t = await makeT();
  const html = render(t);

  assert.match(html, />Check</);
  // No count is known yet, so there must be nothing to click that commits.
  assert.doesNotMatch(html, />Archive</);
});

test('the retention windows are bounded and start at a week', async () => {
  const t = await makeT();
  const html = render(t);

  for (const days of [7, 30, 60, 90]) {
    assert.match(html, new RegExp(`value="${days}"`), `${days}-day window missing`);
  }
  // A zero or negative window would select everything; the server rejects it,
  // and the UI must not offer it either.
  assert.doesNotMatch(html, /value="0"/);
});

test('the default window is 30 days, not the shortest one', async () => {
  const t = await makeT();
  const html = render(t);

  // Defaulting to 7 would make the first check look alarming on a normal
  // week of work.
  assert.match(html, /<select[^>]*>[\s\S]*?<option[^>]*value="30"[^>]*selected/);
});
