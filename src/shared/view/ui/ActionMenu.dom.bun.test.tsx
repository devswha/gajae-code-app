import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import ActionMenu, { type ActionMenuItem } from './ActionMenu';

/*
 * The first test in this repo that opens something.
 *
 * ActionMenu renders its items only while open, so every assertion below was
 * unreachable from the HTML-string tests the client suite is built on - which
 * is why the session menu's own test had to reach past the component and check
 * the array it is built from instead. This checks the menu.
 */

afterEach(cleanup);

const menu = (overrides: Partial<ActionMenuItem>[] = []) => {
  const selected: string[] = [];
  const items: ActionMenuItem[] = [
    { key: 'rename', label: 'Rename', onSelect: () => selected.push('rename') },
    { key: 'delete', label: 'Delete', isDanger: true, onSelect: () => selected.push('delete') },
    ...overrides.map((override, index) => ({
      key: `extra-${index}`,
      label: `Extra ${index}`,
      onSelect: () => selected.push(`extra-${index}`),
      ...override,
    })),
  ];

  render(createElement(ActionMenu, { label: 'Actions', items }));
  return { selected, trigger: screen.getByRole('button', { name: 'Actions' }) };
};

test('the items exist only while the menu is open', () => {
  const { trigger } = menu();

  assert.equal(screen.queryByRole('menuitem', { name: 'Rename' }), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  fireEvent.click(trigger);

  assert.ok(screen.getByRole('menuitem', { name: 'Rename' }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  // The trigger names the menu it controls, for screen readers.
  assert.equal(trigger.getAttribute('aria-controls'), screen.getByRole('menu').id);
});

test('choosing an item runs it once and closes the menu', () => {
  const { selected, trigger } = menu();

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

  assert.deepEqual(selected, ['delete']);
  assert.equal(screen.queryByRole('menu'), null);
});

test('a disabled item cannot be run and does not close the menu', () => {
  const { selected, trigger } = menu([{ label: 'Blocked', disabled: true }]);

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Blocked' }));

  assert.deepEqual(selected, []);
  assert.ok(screen.getByRole('menu'), 'the menu stays open when nothing happened');
});

test('escape closes the menu and returns focus to the trigger', () => {
  const { trigger } = menu();

  fireEvent.click(trigger);
  assert.notEqual(document.activeElement, trigger, 'focus moves into the menu on open');

  fireEvent.keyDown(document, { key: 'Escape' });

  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(document.activeElement, trigger);
});

test('a click outside closes the menu without stealing focus', () => {
  const { trigger } = menu();

  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);

  assert.equal(screen.queryByRole('menu'), null);
  // Deliberate: an outside click belongs to whatever was clicked, so focus is
  // not pulled back to a trigger the user just dismissed.
  assert.notEqual(document.activeElement, trigger);
});
