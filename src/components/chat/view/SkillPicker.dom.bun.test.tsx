import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import '../../../i18n/config';

import SkillPicker from './SkillPicker';

const skills = [
  { name: '/skill:ralplan', description: 'Plan with consensus' },
  { name: '/skill:ultragoal', description: 'Track a durable goal' },
];

function mount() {
  const picked: string[] = [];
  render(createElement(SkillPicker, { skills, onSelect: (skill) => { picked.push(skill.name); } }));
  return { picked, trigger: screen.getByRole('button', { name: 'Choose a skill' }) };
}

afterEach(cleanup);

test('Escape closes the open popup and returns focus to its trigger', () => {
  const { trigger } = mount();
  fireEvent.click(trigger);
  assert.ok(screen.getByRole('textbox', { name: 'Search skills' }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  fireEvent.keyDown(document, { key: 'Escape' });

  assert.equal(screen.queryByRole('textbox', { name: 'Search skills' }), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
});

test('an Escape another handler already consumed leaves the popup open', () => {
  const { trigger } = mount();
  fireEvent.click(trigger);
  const consume = (event: KeyboardEvent) => event.preventDefault();
  document.addEventListener('keydown', consume, { capture: true });
  try {
    fireEvent.keyDown(document, { key: 'Escape' });
  } finally {
    document.removeEventListener('keydown', consume, { capture: true });
  }
  assert.ok(screen.getByRole('textbox', { name: 'Search skills' }));
});

test('the count on the trigger is the number of available skills', () => {
  const { trigger } = mount();
  assert.equal(trigger.textContent, '2');
});
