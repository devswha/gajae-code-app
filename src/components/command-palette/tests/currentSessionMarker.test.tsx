import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Opening a session is already the resume: the composer sends with that
 * session's id and the worker attaches to its history. So picking the session
 * you are already in has nothing left to do, and the picker used to close on a
 * silent no-op - which reads as "/resume is broken" rather than "there is
 * nothing to resume". The row says which session that is before you click it.
 */

type SessionRow = { id: string; label: string };

/**
 * The marker rule under test, extracted so it can be exercised without
 * mounting cmdk's portal-driven dialog.
 */
export const isCurrentSession = (row: SessionRow, currentSessionId?: string): boolean =>
  Boolean(currentSessionId) && row.id === currentSessionId;

const SessionRowView = ({ row, currentSessionId }: { row: SessionRow; currentSessionId?: string }) =>
  createElement(
    'div',
    null,
    createElement('span', null, row.label),
    isCurrentSession(row, currentSessionId)
      ? createElement('span', { className: 'text-muted-foreground' }, 'Current')
      : null,
  );

test('the open session is marked in the picker', () => {
  const html = renderToStaticMarkup(
    createElement(SessionRowView, {
      row: { id: 'session-a', label: 'Open session' },
      currentSessionId: 'session-a',
    }),
  );

  assert.match(html, /Current/);
});

test('other sessions carry no marker', () => {
  const html = renderToStaticMarkup(
    createElement(SessionRowView, {
      row: { id: 'session-b', label: 'Another session' },
      currentSessionId: 'session-a',
    }),
  );

  assert.doesNotMatch(html, /Current/);
});

test('no open session means no row is marked', () => {
  // The palette also opens from the project view, where nothing is resumed yet.
  assert.equal(isCurrentSession({ id: 'session-a', label: 'x' }, undefined), false);
  assert.equal(isCurrentSession({ id: 'session-a', label: 'x' }, ''), false);
});
