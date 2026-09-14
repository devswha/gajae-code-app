import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

const source = readFileSync(new URL('../../src-tauri/recovery/builtin-browser.js', import.meta.url), 'utf8');

type BrowserState = {
  activeTabId: string;
  profileMode: 'persistent' | 'ephemeral';
  tabs: Array<{ id: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }>;
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

function toolbar(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  document.body.innerHTML = `
    <div id="divider" role="separator" tabindex="0" aria-valuenow="480"></div>
    <main>
      <button data-action="back">Back</button>
      <button data-action="forward">Forward</button>
      <button data-action="reload">Reload</button>
      <form id="url-form"><input id="address"></form>
      <span id="profile"></span>
      <button data-action="close">Close</button>
      <p id="message"></p>
    </main>`;
  (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
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
