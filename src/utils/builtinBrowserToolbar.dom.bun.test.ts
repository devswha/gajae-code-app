import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

const markup = readFileSync(new URL('../../src-tauri/recovery/builtin-browser.html', import.meta.url), 'utf8');
const appearanceSource = readFileSync(new URL('../../src-tauri/recovery/builtin-browser-appearance.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../src-tauri/recovery/builtin-browser.js', import.meta.url), 'utf8');

type BrowserState = {
  activeTabId: string;
  profileMode: 'persistent' | 'ephemeral';
  expanded?: boolean;
  tabs: Array<{ id: string; url: string; title?: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

function toolbar(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  appearance: unknown = { colors: {}, dark: false, language: 'en', fontFamily: 'sans-serif' },
) {
  // Use the actual shipped markup: title updates must not replace its SVGs,
  // controls, accessibility labels or form relationships.
  document.body.innerHTML = markup.match(/<body>([\s\S]*?)<\/body>/u)![1]!.replace(/<script[\s\S]*?<\/script>/gu, '');
  (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: {
    invoke: (command: string, args?: Record<string, unknown>) => command === 'builtin_browser_appearance'
      ? Promise.resolve(appearance)
      : invoke(command, args),
  } };
  Function(source)();
  return {
    address: document.querySelector<HTMLInputElement>('#address')!,
    back: document.querySelector<HTMLButtonElement>('[data-action="back"]')!,
    reload: document.querySelector<HTMLButtonElement>('[data-action="reload"]')!,
    message: document.querySelector<HTMLElement>('#message')!,
    profile: document.querySelector<HTMLElement>('#profile')!,
  };
}

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('i18nextLng');
  document.body.innerHTML = '';
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
});

const state = (overrides: Partial<BrowserState> = {}): BrowserState => ({
  activeTabId: 'tab-1',
  profileMode: 'persistent',
  tabs: [{ id: 'tab-1', url: 'https://example.com/', loading: false, canGoBack: true, canGoForward: false }],
  ...overrides,
});

test('toolbar locks commands while pending, then restores navigation state', async () => {
  const initial = deferred<BrowserState>();
  const calls: unknown[] = [];
  const view = toolbar(async (_command, args) => {
    calls.push(args?.command);
    return initial.promise;
  });

  assert.equal(view.reload.disabled, true);
  assert.equal(view.back.disabled, true);
  initial.resolve(state());
  await initial.promise;
  await flush();

  assert.deepEqual(calls, [{ action: 'state' }]);
  assert.equal(view.reload.disabled, false);
  assert.equal(view.back.disabled, false);
  assert.equal(view.address.value, 'https://example.com/');
  assert.equal(view.profile.textContent, 'Persistent profile');
});

test('toolbar keeps a typed URL during state updates and submits that exact navigation', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let current = state();
  const view = toolbar(async (_command, args) => {
    calls.push(args?.command as Record<string, unknown>);
    return current;
  });
  await flush();

  view.address.focus();
  view.address.value = 'https://typed.example/path';
  current = state({ tabs: [{ ...state().tabs[0]!, url: 'https://remote.example/' }] });
  view.reload.click();
  await flush();
  assert.equal(view.address.value, 'https://typed.example/path');

  view.address.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.deepEqual(calls.at(-1), { action: 'navigate', url: 'https://typed.example/path' });
});

test('toolbar reports command errors and re-enables controls for retry', async () => {
  let attempts = 0;
  const view = toolbar(async () => {
    attempts += 1;
    if (attempts === 1) return state();
    throw new Error('navigation rejected');
  });
  await flush();

  view.reload.click();
  await flush();
  assert.equal(view.message.textContent, 'The browser command could not be completed. Try again.');
  assert.equal(view.reload.disabled, false);
});

test('panel divider resizes from the keyboard without issuing a navigation command', async () => {
  const calls: Array<Record<string, unknown>> = [];
  toolbar(async (_command, args) => {
    calls.push(args?.command as Record<string, unknown>);
    return state();
  });
  await flush();
  const divider = document.querySelector<HTMLElement>('#divider')!;
  assert.equal(divider.getAttribute('aria-label'), 'Browser width');
  const width = window.innerWidth;
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await flush();
  assert.deepEqual(calls.at(-1), { action: 'resize', width: width + 40 });
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await flush();
  assert.deepEqual(calls.at(-1), { action: 'resize', width: width - 40 });
});

test('panel dragging coalesces movement and stops after pointer cancellation', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const pending = deferred<BrowserState>();
  toolbar(async (_command, args) => {
    const command = args?.command as Record<string, unknown>;
    calls.push(command);
    return command.action === 'resize' ? pending.promise : state();
  });
  await flush();
  const divider = document.querySelector<HTMLElement>('#divider')!;
  divider.setPointerCapture = () => {};
  const pointer = (type: string, x: number) => divider.dispatchEvent(new PointerEvent(type, {
    button: 0, pointerId: 7, screenX: x, bubbles: true,
  }));
  const width = window.innerWidth;
  pointer('pointerdown', 600);
  pointer('pointermove', 580);
  pointer('pointermove', 560);
  pointer('pointermove', 540);
  assert.equal(calls.filter((command) => command.action === 'resize').length, 1);
  pending.resolve(state());
  await pending.promise;
  await flush();
  assert.deepEqual(calls.at(-1), { action: 'resize', width: width + 60 });
  pointer('pointercancel', 540);
  const count = calls.length;
  pointer('pointermove', 500);
  assert.equal(calls.length, count);
  assert.equal(divider.hasAttribute('data-dragging'), false);
});

test('page chrome uses the real title as text and preserves its icon controls', async () => {
  const title = '<img src=x onerror=alert(1)> A long page title';
  const view = toolbar(async () => state({ tabs: [{ ...state().tabs[0]!, title, loading: true }] }));
  await flush();
  assert.equal(document.querySelector('#page-title')!.textContent, title);
  assert.equal(document.querySelector('#page-title img'), null);
  assert.ok(view.reload.querySelector('svg'));
  assert.equal(document.documentElement.dataset.loading, 'true');
  assert.equal(document.querySelector('.navigation')!.getAttribute('aria-busy'), 'true');
  assert.ok(view.profile.classList.contains('sr-only'));
});

test('expand and restore send presentation commands without changing the URL', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const view = toolbar(async (_command, args) => {
    const command = args?.command as Record<string, unknown>;
    calls.push(command);
    return state({ expanded: command.expanded === true });
  });
  await flush();
  const button = document.querySelector<HTMLButtonElement>('#expand')!;
  const originalUrl = view.address.value;
  button.click();
  await flush();
  assert.deepEqual(calls.at(-1), { action: 'setExpanded', expanded: true });
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Restore split view');
  button.click();
  await flush();
  assert.deepEqual(calls.at(-1), { action: 'setExpanded', expanded: false });
  assert.equal(view.address.value, originalUrl);
});

test('app appearance supplies semantic colors and language without exposing a page bridge', async () => {
  const view = toolbar(async () => state(), {
    colors: { background: '0 0% 8%', foreground: '40 8% 93%', card: 'url(https://untrusted.example)' },
    dark: true, language: 'ko', fontFamily: 'Pretendard, sans-serif',
  });
  await flush();
  assert.equal(document.documentElement.style.getPropertyValue('--browser-background'), 'hsl(0 0% 8%)');
  assert.equal(document.documentElement.style.getPropertyValue('--browser-card'), '');
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  assert.equal(view.address.getAttribute('aria-label'), '주소');
  assert.equal(document.querySelector('#expand')!.getAttribute('aria-label'), '브라우저 확대');
});

test('appearance reader uses the active app tokens and stored UI language', () => {
  document.documentElement.classList.add('dark');
  document.documentElement.style.setProperty('--background', '0 0% 8%');
  localStorage.setItem('i18nextLng', 'ko');
  const appearance = JSON.parse(Function(`return ${appearanceSource}`)()) as {
    colors: Record<string, string>; language: string; dark: boolean;
  };
  assert.equal(appearance.colors.background, '0 0% 8%');
  assert.equal(appearance.language, 'ko');
  assert.equal(appearance.dark, true);
  assert.deepEqual(Object.keys(appearance).sort(), ['colors', 'dark', 'fontFamily', 'language']);
});

test('Escape restores the displayed URL and the address shortcut selects it', async () => {
  const calls: unknown[] = [];
  const view = toolbar(async (_command, args) => { calls.push(args?.command); return state(); });
  await flush();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true }));
  assert.equal(document.activeElement, view.address);
  assert.equal(view.address.selectionEnd, view.address.value.length);
  view.address.value = 'unfinished edit';
  view.address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(view.address.value, 'https://example.com/');
  assert.deepEqual(calls, [{ action: 'state' }]);
});
