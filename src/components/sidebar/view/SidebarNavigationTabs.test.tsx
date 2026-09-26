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
      sessions: { newTask: 'New conversation' },
      tooltips: { createProject: 'Add a workspace' },
      navigation: { primary: 'Primary navigation' },
    } } },
  });
  return i18n.getFixedT('en', 'sidebar');
}

function renderNavigation(t: TFunction): string {
  return renderToStaticMarkup(createElement(SidebarNavigationTabs, {
    onCreateSession: () => {},
    t,
  }));
}

test('renders one prominent New conversation action without mode tabs', async () => {
  const html = renderNavigation(await makeT());
  assert.match(html, /<nav/);
  assert.match(html, /aria-label="New conversation"/);
  assert.match(html, />New conversation</);
  assert.doesNotMatch(html, /role="tablist"|role="tab"/);
  assert.doesNotMatch(html, /disabled/);
});
