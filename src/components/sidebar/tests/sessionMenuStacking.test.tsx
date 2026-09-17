import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';

import SidebarSessionItem from '../view/SidebarSessionItem';
import type { SessionWithProvider } from '../types/types';
import type { Project } from '../../../types/app';

/*
 * The session action menu hides itself until the row is hovered, and the rows
 * that follow it paint over anything it opens (reproduced in a real browser:
 * every menu-item click landed on the next row's link). The fix keeps the
 * trigger's wrapper lifted and visible for exactly as long as the trigger
 * reports aria-expanded=true - which also survives browsers that do not focus
 * buttons on click, where group-focus-within never engages and the open menu
 * used to disappear mid-reach.
 */

const t = ((key: string) => key) as unknown as TFunction;

const project: Project = {
  projectId: 'p1',
  path: '/tmp/p1',
  fullPath: '/tmp/p1',
  displayName: 'P1',
  sessions: [],
  sessionMeta: { hasMore: false, total: 1 },
} as unknown as Project;

const session: SessionWithProvider = {
  id: 's1',
  summary: 'A session',
  lastActivity: new Date().toISOString(),
  __provider: 'gjc',
  __projectId: 'p1',
} as unknown as SessionWithProvider;

test('the menu wrapper lifts itself while the menu is open', () => {
  const markup = renderToStaticMarkup(
    createElement(SidebarSessionItem, {
      project,
      session,
      selectedSession: null,
      isProcessing: false,
      status: 'idle',
      isMobile: false,
      currentTime: new Date(),
      editingSession: null,
      editingSessionName: '',
      onEditingSessionNameChange: () => {},
      onStartEditingSession: () => {},
      onCancelEditingSession: () => {},
      onSaveEditingSession: () => {},
      onToggleSessionStar: () => {},
      onProjectSelect: () => {},
      onSessionSelect: () => {},
      onDeleteSession: () => {},
      t,
    }),
  );

  assert.match(
    markup,
    /has-aria-expanded:z-50/,
    'the open menu must paint above the rows that follow it',
  );
  assert.match(
    markup,
    /has-aria-expanded:opacity-100/,
    'the wrapper must stay visible while the menu is open, independent of hover and focus',
  );
  assert.match(
    markup,
    /has-aria-expanded:pointer-events-auto/,
    'a collapsed wrapper takes no clicks, so the open menu has to take them back',
  );
});
