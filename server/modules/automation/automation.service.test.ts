import assert from 'node:assert/strict';
import test from 'node:test';

import { AutomationGrantStore } from './automation-grants.js';
import { AutomationService } from './automation.service.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

test('browser authorization is origin-scoped and can persist for one session', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });

    assert.deepEqual(
      await service.authorizeBrowser('session-a', { url: 'https://example.com/private?q=1' }),
      { granted: false, origin: 'https://example.com' },
    );
    assert.deepEqual(
      await service.authorizeBrowser('session-a', { url: 'https://example.com/other', scope: 'session' }),
      { granted: true, origin: 'https://example.com' },
    );
    assert.equal(
      (await service.authorizeBrowser('session-b', { url: 'https://example.com' })).granted,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('browser authorization resolves the active tab when a tool action has no URL', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    service.browser.state = async () => ({
      sessionId: 'session-a',
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', title: 'Docs', url: 'https://docs.example.test/guide', loading: false, canGoBack: false, canGoForward: false }],
    });

    assert.deepEqual(
      await service.authorizeBrowser('session-a', {}),
      { granted: false, origin: 'https://docs.example.test' },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('computer authorization resolves a pid to a bundle identity and scopes the grant', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    service.cua.call = async (tool) => {
      assert.equal(tool, 'list_apps');
      return {
        structuredContent: {
          apps: [{ pid: 42, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' }],
        },
      };
    };

    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 42 } }),
      { granted: false, application: 'com.apple.TextEdit', label: 'TextEdit' },
    );
    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 42 }, scope: 'session' }),
      { granted: true, application: 'com.apple.TextEdit', label: 'TextEdit' },
    );
    assert.equal(
      (await service.authorizeComputer('session-b', { tool: 'click', arguments: { pid: 42 } })).granted,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('computer authorization resolves a window id to its owning application', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    service.cua.call = async (tool) => {
      assert.equal(tool, 'list_windows');
      return {
        structuredContent: {
          apps: [{ pid: 42, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' }],
          windows: [{ pid: 42, window_id: 14747, title: 'README.md' }],
        },
      };
    };

    assert.deepEqual(
      await service.authorizeComputer('session-a', {
        tool: 'get_window_state',
        arguments: { window_id: 14747, include_screenshot: false },
      }),
      { granted: false, application: 'com.apple.TextEdit', label: 'TextEdit' },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('computer discovery does not require an application grant', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'list_apps', arguments: {} }),
      { granted: true, application: null, label: null },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});
