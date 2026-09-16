import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import enCommon from '../../../i18n/locales/en/common.json';
import type { EgoActivitySpace } from '../hooks/useEgoActivity';

import AgentSidebarBrowser from './AgentSidebarBrowser';

afterEach(cleanup);

const space = (overrides: Partial<EgoActivitySpace> = {}): EgoActivitySpace => ({
  id: 15,
  name: 'check the release dashboard',
  pages: [
    { label: 'p1', url: 'https://example.com/releases', title: 'Releases', active: true },
    { label: 'p2', url: 'https://example.com/changelog', title: 'Changelog', active: false },
  ],
  ...overrides,
});

async function setup(spaces: EgoActivitySpace[], options: { frames?: boolean; sessionId?: string } = {}) {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: enCommon } }, interpolation: { escapeValue: false } });
  return render(
    <I18nextProvider i18n={i18n}>
      <AgentSidebarBrowser
        spaces={spaces}
        sessionId={'sessionId' in options ? options.sessionId : 'session-1'}
        frames={options.frames ?? false}
      />
    </I18nextProvider>,
  );
}

const row = (name: RegExp) => screen.getByRole('button', { name });

test('the collapsed row names the Space and the page ego reports as active, and nothing else', async () => {
  await setup([space()]);

  const trigger = row(/check the release dashboard/);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.match(trigger.textContent!, /https:\/\/example\.com\/releases/);
  // The other page exists but is not the answer to "where is the browser now".
  assert.equal(screen.queryByText('Changelog'), null);
  assert.equal(screen.queryByText('https://example.com/changelog'), null);
});

test('expanding lists every page of the Space with its title and marks the active one', async () => {
  await setup([space()]);

  fireEvent.click(row(/check the release dashboard/));
  assert.equal(row(/check the release dashboard/).getAttribute('aria-expanded'), 'true');

  const pages = screen.getAllByRole('listitem').filter((item) => item.hasAttribute('title') && item.closest('ul')!.className.includes('pl-7'));
  assert.deepEqual(pages.map((item) => item.textContent), [
    'Active page: Releaseshttps://example.com/releases',
    'Changeloghttps://example.com/changelog',
  ]);
  // The active page is marked for assistive technology, not by colour alone.
  assert.deepEqual(pages.map((item) => item.getAttribute('aria-current')), ['true', null]);

  fireEvent.click(row(/check the release dashboard/));
  assert.equal(screen.queryByText('Changelog'), null);
});

test('a page without a title falls back to its address instead of rendering an empty line', async () => {
  await setup([space({ pages: [{ label: 'p1', url: 'https://example.com/a', title: '', active: true }] })]);

  fireEvent.click(row(/check the release dashboard/));
  const page = within(screen.getByRole('button', { name: /check the release dashboard/ }).parentElement!).getAllByRole('listitem')[0];
  assert.equal(page.textContent, 'Active page: https://example.com/a');
});

test('a Space with no page yet is not expandable and invents no address', async () => {
  await setup([space({ name: '', pages: [] })]);

  const trigger = row(/Browser space 15/);
  assert.equal((trigger as HTMLButtonElement).disabled, true);
  assert.doesNotMatch(trigger.textContent!, /http/);
});

test('simultaneous Spaces are capped and the rest are counted, never listed', async () => {
  await setup([1, 2, 3, 4].map((id) => space({ id, name: `space ${id}` })));

  assert.ok(row(/space 1/));
  assert.ok(row(/space 2/));
  assert.equal(screen.queryByRole('button', { name: /space 3/ }), null);
  assert.ok(screen.getByText('+2 more'));
});

test('the page picture appears only when its own opt-in is on, and only inside an open row', async () => {
  await setup([space()], { frames: true });

  // A collapsed row costs no capture in the user's real browser.
  assert.equal(screen.queryByRole('img', { name: 'Browser screen' }), null);

  fireEvent.click(row(/check the release dashboard/));
  const frame = screen.getByRole('img', { name: 'Browser screen' }) as HTMLImageElement;
  const url = new URL(frame.src, 'http://localhost');
  assert.equal(url.pathname, '/api/automation/ego-activity/frame');
  assert.equal(url.searchParams.get('sessionId'), 'session-1');
  assert.equal(url.searchParams.get('space'), '15');
  // The active page is the one shown, not merely the first.
  assert.equal(url.searchParams.get('page'), 'p1');

  fireEvent.click(row(/check the release dashboard/));
  assert.equal(screen.queryByRole('img', { name: 'Browser screen' }), null);
});

test('with the picture opt-in off the row still expands, it just has no picture', async () => {
  await setup([space()], { frames: false });
  fireEvent.click(row(/check the release dashboard/));

  assert.equal(screen.queryByRole('img', { name: 'Browser screen' }), null);
  assert.ok(screen.getByText('Changelog'), 'the page list is unaffected');
});

test('a capture that cannot be taken removes the picture instead of leaving a stale one', async () => {
  await setup([space()], { frames: true });
  fireEvent.click(row(/check the release dashboard/));

  const frame = screen.getByRole('img', { name: 'Browser screen' });
  // A minimized ego window produces no frame at all, and the endpoint 404s.
  fireEvent.error(frame);
  assert.equal(screen.queryByRole('img', { name: 'Browser screen' }), null);
  assert.ok(screen.getByText('Releases'), 'the addresses stay, because those never depend on a capture');
});

test('no spaces means no block at all: the lane stays silent rather than empty', async () => {
  const view = await setup([]);
  assert.equal(view.container.innerHTML, '');
});
