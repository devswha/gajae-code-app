import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GJC_BROWSER_BACKEND,
  GJC_ASIDE_UNAVAILABLE_CODE,
  GJC_ASIDE_UNAVAILABLE_MESSAGE,
  GJC_BROWSER_BACKENDS,
  GJC_EGO_BROWSER_INSTRUCTIONS,
  GJC_EGO_UNAVAILABLE_CODE,
  GJC_EGO_UNAVAILABLE_MESSAGE,
  GjcAsideUnavailableError,
  GjcEgoUnavailableError,
  egoBrowserCliCandidates,
  isGjcAsideUnavailableError,
  isGjcBrowserBackend,
  isGjcEgoUnavailableError,
  probeEgoBrowserCli,
} from './gjc-browser-backend.js';

test('Built-in is the default backend and public choices do not expose the runtime setting name', () => {
  assert.equal(DEFAULT_GJC_BROWSER_BACKEND, 'builtin');
  assert.deepEqual([...GJC_BROWSER_BACKENDS], ['builtin', 'aside', 'ego']);
  assert.equal(isGjcBrowserBackend('builtin'), true);
  assert.equal(isGjcBrowserBackend('aside'), true);
  assert.equal(isGjcBrowserBackend('ego'), true);
  for (const rejected of ['native', 'Aside', 'Ego', 'ego-lite', 'puppeteer', '', undefined, null, 1, {}]) {
    assert.equal(isGjcBrowserBackend(rejected), false, JSON.stringify(rejected));
  }
});

test('an unavailable Aside CLI fails with a stable code and fixed text that carries no probe detail', () => {
  const error = new GjcAsideUnavailableError(['/home/someone/.local/bin/aside', 'PATH (aside)']);
  assert.equal(error.code, GJC_ASIDE_UNAVAILABLE_CODE);
  assert.equal(error.code, 'aside_unavailable');
  assert.equal(error.message, GJC_ASIDE_UNAVAILABLE_MESSAGE);
  assert.equal(error.message.includes('/home/someone'), false);
  assert.match(error.message, /Built-in/);
  assert.deepEqual(error.searched, ['/home/someone/.local/bin/aside', 'PATH (aside)']);
  assert.equal(isGjcAsideUnavailableError(error), true);
  assert.equal(isGjcAsideUnavailableError(new Error(GJC_ASIDE_UNAVAILABLE_MESSAGE)), false);
  assert.equal(isGjcAsideUnavailableError({ code: GJC_ASIDE_UNAVAILABLE_CODE }), false);
});

test('an unavailable ego-browser CLI fails with a stable code and fixed text that carries no probe detail', () => {
  const error = new GjcEgoUnavailableError(['/home/someone/.local/bin/ego-browser', 'PATH (ego-browser)']);
  assert.equal(error.code, GJC_EGO_UNAVAILABLE_CODE);
  assert.equal(error.code, 'ego_unavailable');
  assert.equal(error.message, GJC_EGO_UNAVAILABLE_MESSAGE);
  assert.equal(error.message.includes('/home/someone'), false);
  assert.match(error.message, /Built-in/);
  assert.deepEqual(error.searched, ['/home/someone/.local/bin/ego-browser', 'PATH (ego-browser)']);
  assert.equal(isGjcEgoUnavailableError(error), true);
  assert.equal(isGjcEgoUnavailableError(new GjcAsideUnavailableError()), false);
  assert.equal(isGjcAsideUnavailableError(error), false);
  assert.equal(isGjcEgoUnavailableError(new Error(GJC_EGO_UNAVAILABLE_MESSAGE)), false);
});

test('the ego-browser probe prefers the onboarding location, then PATH, and reports what it searched', () => {
  assert.deepEqual(egoBrowserCliCandidates('/home/someone'), ['/home/someone/.local/bin/ego-browser']);
  const executables = new Set(['/opt/tools/ego-browser']);
  const isExecutable = (filePath: string) => executables.has(filePath);
  assert.deepEqual(
    probeEgoBrowserCli({ home: '/home/someone', path: '/usr/bin:/opt/tools', isExecutable }),
    { ok: true, path: '/opt/tools/ego-browser' },
  );
  executables.add('/home/someone/.local/bin/ego-browser');
  assert.deepEqual(
    probeEgoBrowserCli({ home: '/home/someone', path: '/usr/bin:/opt/tools', isExecutable }),
    { ok: true, path: '/home/someone/.local/bin/ego-browser' },
  );
  assert.deepEqual(
    probeEgoBrowserCli({ home: '/home/nobody', path: '/usr/bin::', isExecutable }),
    { ok: false, searched: ['/home/nobody/.local/bin/ego-browser', 'PATH (ego-browser)'] },
  );
  assert.deepEqual(probeEgoBrowserCli({ home: '/home/nobody', path: '', isExecutable }).ok, false);
});

test('the app-owned ego routing block names the CLI entry point and the skill, and disables every other browser path', () => {
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /^<browser-backend>\n/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /\n<\/browser-backend>$/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /ego-browser nodejs <<'EOF'/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /installed `ego-browser` skill/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /taskSpace\(name\)/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /NEVER use or register an MCP browser server/);
  assert.equal(GJC_EGO_BROWSER_INSTRUCTIONS.toLowerCase().includes('aside'), false);
});
