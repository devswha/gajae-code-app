import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';

import SidebarSessionItem from '../view/subcomponents/SidebarSessionItem';
import type { SessionWithProvider } from '../types/types';
import type { Project } from '../../../types/app';

/*
 * The session action menu renders inside an absolutely positioned wrapper that
 * carries a translate transform, which makes the wrapper a stacking context.
 * Without an explicit z-index while the menu is open, the FOLLOWING session
 * rows paint over the open menu and steal its clicks (reproduced in a real
 * browser: every menu-item click landed on the next row's link). The fix keeps
 * the wrapper lifted and visible for exactly as long as the trigger reports
 * aria-expanded=true - which also survives browsers that do not focus buttons
 * on click, where group-focus-within never engages and the open menu used to
 * fade out mid-reach.
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
      needsAttention: false,
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
    /has-\[\[aria-expanded=true\]\]:z-50/,
    'the open menu must escape the transform stacking context above later rows',
  );
  assert.match(
    markup,
    /has-\[\[aria-expanded=true\]\]:opacity-100/,
    'the wrapper must stay visible while the menu is open, independent of hover and focus',
  );
});
