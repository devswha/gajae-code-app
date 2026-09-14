import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, renderHook } from '@testing-library/react';

import { isDesktopShell, markDesktopShell } from '../../../utils/externalLink';
import type { AuthUserPayload } from '../types';

import { AuthProvider, useAuth } from './AuthContext';

const BOOTSTRAP_PATH = '/api/auth/user';

function ownerPayload(desktop: boolean): AuthUserPayload {
  return { user: { id: 1, username: 'owner' }, shell: { desktop } };
}

function reply(status: number, body: unknown = { error: 'status' }): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const installFetch = (responses: Array<() => Response>) => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return next();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
};

// The retry delay is the only timer this component schedules; everything else
// (the request abort timeout, React scheduling) passes through untouched.
function retryTimers() {
  const pending = new Map<number, () => void>();
  let id = 50_000;
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
    const [callback, delay] = args;
    if (delay !== 3000) return originalSetTimeout.apply(window, args as unknown as Parameters<typeof setTimeout>);
    pending.set(++id, callback as () => void);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = (timer) => {
    if (typeof timer === 'number' && pending.delete(timer)) return;
    originalClearTimeout.call(window, timer);
  };
  return {
    pending,
    fire: async () => {
      await act(async () => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback();
      });
    },
  };
}

function renderAuth() {
  return { view: renderHook(useAuth, { wrapper: AuthProvider }) };
}

const flush = async () => { await act(async () => {}); };

afterEach(() => {
  cleanup();
  markDesktopShell(false);
});

test('a successful bootstrap records the shell flag and the owner', async () => {
  const fetch = installFetch([() => reply(200, ownerPayload(true))]);
  try {
    const { view } = renderAuth();
    await flush();
    assert.equal(isDesktopShell(), true);
    assert.equal(view.result.current.user?.username, 'owner');
    assert.equal(view.result.current.isLoading, false);
    assert.deepEqual(fetch.calls, [BOOTSTRAP_PATH]);
  } finally {
    fetch.restore();
  }
});

test('a browser payload keeps the shell flag off', async () => {
  const fetch = installFetch([() => reply(200, ownerPayload(false))]);
  try {
    renderAuth();
    await flush();
    assert.equal(isDesktopShell(), false);
  } finally {
    fetch.restore();
  }
});

test('a transient failure retries quietly and still wires the shell afterwards', async () => {
  const clock = retryTimers();
  const fetch = installFetch([() => reply(503), () => reply(200, ownerPayload(true))]);
  try {
    const { view } = renderAuth();
    await flush();
    // The failed first attempt renders the app and schedules exactly one retry.
    assert.equal(view.result.current.isLoading, false);
    assert.equal(isDesktopShell(), false, 'the flag must not be guessed before the server answers');
    assert.deepEqual(fetch.calls, [BOOTSTRAP_PATH]);
    assert.equal(clock.pending.size, 1);

    await clock.fire();
    assert.equal(isDesktopShell(), true, 'the recovered bootstrap must still mark the desktop shell');
    assert.equal(view.result.current.user?.username, 'owner');
    assert.deepEqual(fetch.calls, [BOOTSTRAP_PATH, BOOTSTRAP_PATH]);
    assert.equal(clock.pending.size, 0);
  } finally {
    fetch.restore();
  }
});

test('a 4xx is an auth state, not an outage: no retry', async () => {
  const clock = retryTimers();
  const fetch = installFetch([() => reply(401)]);
  try {
    const { view } = renderAuth();
    await flush();
    assert.deepEqual(fetch.calls, [BOOTSTRAP_PATH]);
    assert.equal(clock.pending.size, 0);
    assert.equal(view.result.current.user, null);
    assert.equal(view.result.current.isLoading, false);
  } finally {
    fetch.restore();
  }
});

test('the retry gives up after its budget instead of polling forever', async () => {
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (error: unknown) => { errors.push(error); };
  const clock = retryTimers();
  const fetch = installFetch([() => reply(500)]);
  try {
    renderAuth();
    await flush();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      assert.equal(clock.pending.size, 1, `retry ${attempt + 1} was scheduled`);
      await clock.fire();
      await flush();
    }
    assert.equal(clock.pending.size, 0, 'the retries stop at the limit');
    assert.equal(fetch.calls.length, 13, 'one bootstrap attempt plus the retry budget');
    assert.equal(errors.length, 1);
    assert.equal(isDesktopShell(), false);
  } finally {
    console.error = originalError;
    fetch.restore();
  }
});
