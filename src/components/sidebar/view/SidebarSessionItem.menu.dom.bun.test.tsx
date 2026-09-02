import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance, type TFunction } from 'i18next';

import type { SessionStatus } from '../../../stores/sessionStatusModel';

import SidebarSessionItem from './SidebarSessionItem';
import { sidebarProjectsFixture } from './SidebarContent.testFixture';

/*
 * The session row as a browser sees it: the overflow menu opening on a real
 * click, and the status marker that an accessibility snapshot cannot show.
 *
 * Both exist because a smoke test driven through an accessibility tree
 * reported them missing. That tree exposes neither `data-*` attributes nor
 * elements that are invisible to it, so the row has to be proven here, in a
 * DOM, rather than argued about.
 */

afterEach(cleanup);

async function makeT(): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        sidebar: {
          sessions: { pin: 'Pin', unpin: 'Unpin', renameSession: 'Rename conversation', regenerateTitle: 'Regenerate title', exportSession: 'Export Markdown', deleteSession: 'Delete conversation' },
          status: { running: 'Running', needsInput: 'Waiting for your input', ready: 'Finished, not viewed yet', blocked: 'Run failed, not viewed yet' },
          tooltips: { sessionActions: 'Conversation actions', save: 'Save', cancel: 'Cancel' },
        },
      },
    },
  });
  return i18n.getFixedT('en', 'sidebar');
}

async function mountRow(status: SessionStatus, handlers: { onRegenerateTitle?: (id: string) => void } = {}) {
  const t = await makeT();
  const project = sidebarProjectsFixture[0];
  const session = { ...project.sessions![0], __provider: 'gjc' as const };
  const { container } = render(
    <SidebarSessionItem
      project={project}
      session={session}
      selectedSession={null}
      isProcessing={false}
      status={status}
      currentTime={new Date('2026-07-21T10:20:00.000Z')}
      editingSession={null}
      editingSessionName=""
      onEditingSessionNameChange={() => {}}
      onStartEditingSession={() => {}}
      onCancelEditingSession={() => {}}
      onSaveEditingSession={() => {}}
      onToggleSessionStar={() => {}}
      onExportSession={() => {}}
      onProjectSelect={() => {}}
      onSessionSelect={() => {}}
      onDeleteSession={() => {}}
      t={t}
      {...handlers}
    />,
  );
  // The row renders a mobile and a desktop layout and CSS picks one; in a
  // DOM without stylesheets both exist, so the test reaches for the desktop
  // one explicitly, the way a viewport wider than `md` would.
  const desktop = container.querySelector<HTMLElement>('.hidden.md\\:block')!;
  return { container, desktop, sessionId: session.id };
}

test('the row carries its status as data even when idle, and an accessible indicator only when it has something to say', async () => {
  const idle = await mountRow('idle');
  assert.equal(idle.container.querySelector('[data-session-status]')?.getAttribute('data-session-status'), 'idle');
  assert.equal(idle.container.querySelectorAll('[role="status"]').length, 0, 'an idle row has no indicator to label');
  cleanup();

  const ready = await mountRow('ready');
  const dot = ready.container.querySelector('[role="status"][data-session-status="ready"]');
  assert.ok(dot, 'a finished, unread run gets a labelled indicator');
  assert.equal(dot.getAttribute('aria-label'), 'Finished, not viewed yet');
  cleanup();

  const needsInput = await mountRow('needs_input');
  const labels = [...needsInput.container.querySelectorAll('[role="status"][data-session-status="needs_input"]')].map((el) => el.getAttribute('aria-label'));
  assert.ok(labels.length >= 1 && labels.every((label) => label === 'Waiting for your input'), `dot and glyph both announce the state: ${labels.join(', ')}`);
});

test('a click on the row menu opens it with Regenerate title in place, and the item runs', async () => {
  const regenerated: string[] = [];
  const { desktop, sessionId } = await mountRow('idle', { onRegenerateTitle: (id) => regenerated.push(id) });
  const trigger = within(desktop).getByRole('button', { name: 'Conversation actions' });

  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  const names = screen.getAllByRole('menuitem').map((item) => item.textContent);
  assert.deepEqual(names, ['Pin', 'Rename conversation', 'Regenerate title', 'Export Markdown', 'Delete conversation']);

  fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate title' }));
  assert.deepEqual(regenerated, [sessionId]);
  assert.equal(screen.queryByRole('menu'), null, 'choosing an item closes the menu');
});

test('the menu trigger is reachable without a pointer: it is a focusable button that toggles on click', async () => {
  const { desktop } = await mountRow('idle', { onRegenerateTitle: () => {} });
  const trigger = within(desktop).getByRole('button', { name: 'Conversation actions' });

  trigger.focus();
  assert.equal(document.activeElement, trigger, 'Tab can land on the trigger');
  // Enter on a native <button> is a click in every browser; the DOM used here
  // does not synthesise it, so the activation is dispatched as a click.
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByRole('menuitem', { name: 'Regenerate title' }));

  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(document.activeElement, trigger, 'Escape hands focus back to the trigger');
});
