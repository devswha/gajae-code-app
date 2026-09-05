import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';

import { ThemeProvider } from '../../../contexts/ThemeContext';
import english from '../../../i18n/locales/en/settings.json';
import { useEscapeToAbort } from '../../chat/hooks/useEscapeToAbort';

import Settings from './Settings';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { settings: english } } });
const originalFetch = globalThis.fetch;
const originalOverflow = document.body.style.overflow;

beforeEach(() => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  document.body.style.overflow = originalOverflow;
  localStorage.clear();
});

function mount() {
  let closeCount = 0;
  let abortCount = 0;
  function Harness() {
    const [open, setOpen] = useState(false);
    useEscapeToAbort(true, () => { abortCount++; });
    return <>
      <button onClick={() => setOpen(true)}>Open settings</button>
      {/* SidebarModals unmounts Settings on close, rather than retaining it. */}
      {open && <Settings isOpen onClose={() => { closeCount++; setOpen(false); }} />}
    </>;
  }
  render(<I18nextProvider i18n={i18n}><ThemeProvider><Harness /></ThemeProvider></I18nextProvider>);
  const opener = screen.getByRole('button', { name: 'Open settings' });
  const open = () => {
    act(() => opener.focus());
    fireEvent.click(opener);
  };
  return { opener, open, closeCount: () => closeCount, abortCount: () => abortCount };
}

test('Settings has a named modal and close button, autofocuses inside, and restores focus after clicking close', async () => {
  const view = mount();
  view.open();
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const close = within(dialog).getByRole('button', { name: 'Close settings' });
  await waitFor(() => assert.equal(document.activeElement, close));
  fireEvent.click(close);
  assert.equal(view.closeCount(), 1);
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(document.activeElement, view.opener);
});

test('Escape on either Appearance navigation button closes Settings once and restores focus and scrolling', async () => {
  document.body.style.overflow = 'scroll';
  const view = mount();
  for (const index of [0, 1]) {
    view.open();
    const appearance = screen.getAllByRole('button', { name: 'Appearance' })[index];
    await waitFor(() => assert.notEqual(document.activeElement, view.opener));
    act(() => appearance.focus());
    assert.equal(document.body.style.overflow, 'hidden');
    fireEvent.keyDown(appearance, { key: 'Escape' });
    assert.equal(view.closeCount(), index + 1);
    assert.equal(view.abortCount(), 0, 'closing Settings must not abort the background run');
    assert.equal(screen.queryByRole('button', { name: 'Close settings' }), null);
    assert.equal(document.activeElement, view.opener);
    assert.equal(document.body.style.overflow, 'scroll');
  }
  fireEvent.keyDown(view.opener, { key: 'Escape' });
  assert.equal(view.abortCount(), 1, 'the chat shortcut resumes after Settings closes');
});

test('Tab and Shift+Tab stay inside Settings at both ends of the Appearance controls', async () => {
  const view = mount();
  view.open();
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  const first = within(dialog).getByRole('button', { name: 'Close settings' });
  const last = within(dialog).getByDisplayValue('Alphabetical');
  await waitFor(() => assert.equal(document.activeElement, first));
  act(() => last.focus());
  fireEvent.keyDown(last, { key: 'Tab' });
  assert.equal(document.activeElement, first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, last);
  assert.equal(view.closeCount(), 0);
});
