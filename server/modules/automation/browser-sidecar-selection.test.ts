import assert from 'node:assert/strict';
import test from 'node:test';

import type { Browser, LaunchOptions } from 'puppeteer-core';

import { launchBrowserWithLinuxFallback } from './browser-sidecar.js';

const options = {
  userDataDir: '/isolated-app/browser/profile', headless: true,
  args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
};
const browser = {} as Browser;
const managed = '/isolated-app/chromium/chrome';
const system = '/opt/google/chrome/chrome';
const sandboxErrors = [
  new Error('Failed to launch the browser process: No usable sandbox!'),
  new Error('The SUID sandbox helper binary was found, but is not configured correctly.'),
  new Error('Failed to move to new namespace: PID namespaces supported, Network namespace supported, but failed: errno = Operation not permitted'),
];

test('a working managed browser stays selected without probing system Chrome', async () => {
  const calls: LaunchOptions[] = [];
  assert.equal(await launchBrowserWithLinuxFallback(managed, options, {
    platform: 'linux', explicitExecutable: false,
    launch: async input => { calls.push(input); return browser; },
    systemExecutable: () => { assert.fail('must not inspect system browsers'); },
  }), browser);
  assert.deepEqual(calls, [{ ...options, executablePath: managed }]);
});

test('Linux sandbox failures retry known installed Chrome using exactly the same private profile and sandbox flags', async t => {
  for (const failure of sandboxErrors) {
    await t.test(failure.message, async () => {
      const calls: LaunchOptions[] = [];
      assert.equal(await launchBrowserWithLinuxFallback(managed, options, {
        platform: 'linux', explicitExecutable: false, systemExecutable: () => system,
        launch: async input => {
          calls.push(input);
          if (calls.length === 1) throw failure;
          return browser;
        },
      }), browser);
      assert.deepEqual(calls, [{ ...options, executablePath: managed }, { ...options, executablePath: system }]);
      for (const input of calls) {
        assert.equal(input.userDataDir, '/isolated-app/browser/profile');
        assert.equal(Object.hasOwn(input, 'channel'), false);
        assert.equal(input.args?.some(arg => /--(?:no-sandbox|disable-setuid-sandbox|disable-namespace-sandbox)/.test(arg)), false);
      }
    });
  }
});

test('explicit overrides and non-Linux launches retain their original error without fallback', async () => {
  for (const config of [
    { platform: 'linux' as const, explicitExecutable: true },
    { platform: 'darwin' as const, explicitExecutable: false },
    { platform: 'win32' as const, explicitExecutable: false },
  ]) {
    let calls = 0;
    await assert.rejects(launchBrowserWithLinuxFallback(managed, options, {
      ...config,
      launch: async () => { calls++; throw sandboxErrors[0]; },
      systemExecutable: () => { assert.fail('must not inspect system browsers'); },
    }), error => error === sandboxErrors[0]);
    assert.equal(calls, 1);
  }
});

test('missing libraries, profile locks, timeouts and root execution errors are not mistaken for managed sandbox failures', async () => {
  for (const message of [
    'error while loading shared libraries: libnss3.so: cannot open shared object file',
    'ProcessSingleton: Failed to create SingletonLock: File exists',
    'Timed out after 30000 ms while waiting for the WS endpoint URL',
    'Running as root without --no-sandbox is not supported',
  ]) {
    const failure = new Error(message);
    await assert.rejects(launchBrowserWithLinuxFallback(managed, options, {
      platform: 'linux', explicitExecutable: false,
      launch: async () => { throw failure; },
      systemExecutable: () => { assert.fail('must not inspect system browsers'); },
    }), error => error === failure);
  }
});

test('absent system Chrome or an identical executable preserves the managed failure', async () => {
  for (const systemExecutable of [() => { throw new Error('Chrome not installed'); }, () => managed]) {
    let calls = 0;
    await assert.rejects(launchBrowserWithLinuxFallback(managed, options, {
      platform: 'linux', explicitExecutable: false, systemExecutable,
      launch: async () => { calls++; throw sandboxErrors[0]; },
    }), error => error === sandboxErrors[0]);
    assert.equal(calls, 1);
  }
});

test('a failed system fallback is reported once with the original sandbox error as its cause', async () => {
  let calls = 0;
  await assert.rejects(launchBrowserWithLinuxFallback(managed, options, {
    platform: 'linux', explicitExecutable: false, systemExecutable: () => system,
    launch: async () => {
      calls++;
      throw calls === 1 ? sandboxErrors[0] : new Error('system sandbox unavailable');
    },
  }), error => error instanceof Error && error.cause === sandboxErrors[0] && /Installed Chrome fallback failed: system sandbox unavailable/.test(error.message));
  assert.equal(calls, 2);
});
