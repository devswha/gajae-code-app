import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance, type TFunction } from 'i18next';

import SidebarNavigationTabs from './SidebarNavigationTabs';

async function makeT(): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: { en: { sidebar: {
      sessions: { newTask: 'New task' },
      tooltips: { selectProjectToCreateSession: 'Add a project before starting a new task' },
    } } },
  });
  return i18n.getFixedT('en', 'sidebar');
}

function renderNavigation(t: TFunction, canCreateSession: boolean): string {
  return renderToStaticMarkup(createElement(SidebarNavigationTabs, {
    canCreateSession,
    onCreateSession: () => {},
    t,
  }));
}

test('renders one prominent New task action without mode tabs', async () => {
  const html = renderNavigation(await makeT(), true);
  assert.match(html, /<nav/);
  assert.match(html, /aria-label="New task"/);
  assert.match(html, />New task</);
  assert.doesNotMatch(html, /role="tablist"|role="tab"/);
});

test('disables New task without opening project creation when no projects exist', async () => {
  const html = renderNavigation(await makeT(), false);
  assert.match(html, /title="Add a project before starting a new task"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Create a project to start a new task/);
});
