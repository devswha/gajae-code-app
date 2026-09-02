import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { defaultProjectPermissions, type ProjectPermissions } from '../../../hooks/useProjectPermissions';
import { opensPermissionModePicker } from '../utils/permissionMode';
import PermissionModePicker from '../view/PermissionModePicker';

const permissions = (overrides: Partial<ProjectPermissions> = {}): ProjectPermissions => ({
  ...defaultProjectPermissions('project-1'),
  projectPath: '/work/alpha',
  ...overrides,
});

const renderPicker = (value: ProjectPermissions | null) => renderToStaticMarkup(
  createElement(PermissionModePicker, { permissions: value, onSelectMode: () => undefined }),
);

test('the closed trigger names the current mode and nothing else', () => {
  const html = renderPicker(permissions());

  assert.match(html, /data-mode="ask"/);
  assert.match(html, /permissionMode\.modes\.ask\.label/);
  // No popup and no confirmation dialog are in the static markup.
  assert.doesNotMatch(html, /role="listbox"/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /permissionMode\.modes\.bypass\.label/);
});

test('bypass is drawn in the destructive colour so it cannot pass for a tuning knob', () => {
  const ask = renderPicker(permissions({ mode: 'ask' }));
  const bypass = renderPicker(permissions({ mode: 'bypass', bypassAcknowledged: true }));

  assert.doesNotMatch(ask, /text-destructive/);
  assert.match(bypass, /data-mode="bypass"[^>]*class="[^"]*text-destructive/);
});

test('the trigger is disabled until the project policy is known', () => {
  assert.match(renderPicker(null), /<button[^>]*\sdisabled=""/);
  assert.doesNotMatch(renderPicker(permissions()), /<button[^>]*\sdisabled=""/);
});

test('the shortcut is Cmd/Ctrl+Shift+P and refuses lookalikes', () => {
  const chord = (overrides: Partial<Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>> = {}) => ({
    key: 'p', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, ...overrides,
  });

  assert.equal(opensPermissionModePicker(chord({ metaKey: true, shiftKey: true })), true);
  assert.equal(opensPermissionModePicker(chord({ ctrlKey: true, shiftKey: true, key: 'P' })), true);
  // Plain Cmd+P is the browser's print; Cmd+Shift+D is the density toggle.
  assert.equal(opensPermissionModePicker(chord({ metaKey: true })), false);
  assert.equal(opensPermissionModePicker(chord({ metaKey: true, shiftKey: true, key: 'd' })), false);
  assert.equal(opensPermissionModePicker(chord({ metaKey: true, shiftKey: true, altKey: true })), false);
  assert.equal(opensPermissionModePicker(chord({ metaKey: true, shiftKey: true, repeat: true })), false);
});
