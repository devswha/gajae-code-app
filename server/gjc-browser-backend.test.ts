import assert from 'node:assert/strict';
import test from 'node:test';

import { BROWSER_BACKENDS } from '../src/components/settings/browserBackends.js';

import {
  DEFAULT_GJC_BROWSER_BACKEND,
  GJC_ASIDE_UNAVAILABLE_CODE,
  GJC_ASIDE_UNAVAILABLE_MESSAGE,
  GJC_BROWSER_BACKENDS,
  GJC_EGO_BROWSER_INSTRUCTIONS,
  GJC_EGO_BROWSER_UNAVAILABLE_INSTRUCTIONS,
  GJC_EGO_UNAVAILABLE_CODE,
  GJC_EGO_UNAVAILABLE_MESSAGE,
  GjcAsideUnavailableError,
  GjcEgoUnavailableError,
  buildGjcEgoBrowserInstructions,
  egoBrowserCliCandidates,
  isGjcAsideUnavailableError,
  isGjcBrowserBackend,
  isGjcEgoUnavailableError,
  probeEgoBrowserCli,
  testEgoBrowserConnection,
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

test('the Settings backend vocabulary stays aligned with the server contract', () => {
  assert.deepEqual([...BROWSER_BACKENDS], [...GJC_BROWSER_BACKENDS]);
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
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /'[^']*ego-browser' nodejs <<'EOF'/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /installed `ego-browser` skill/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /taskSpace\(name\)/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /NEVER use or register an MCP browser server/);
  assert.match(GJC_EGO_BROWSER_INSTRUCTIONS, /never substitute.*Aside.*computer/iu);
});

test('the Ego routing block pins and POSIX-quotes the probe-resolved executable', () => {
  const block = buildGjcEgoBrowserInstructions("/tmp/ego browser/'safe'/ego-browser");
  assert.ok(block.includes("'/tmp/ego browser/'\\''safe'\\''/ego-browser' nodejs"));
  assert.match(block, /ego-browser import/);
  assert.match(block, /ego-browser upgrade/);
  assert.match(block, /ego-browser onboarding/);
  assert.match(block, /computer.*CUA.*browser/iu);
});

test('the unavailable Ego policy preserves ordinary chat and forbids browser substitution', () => {
  assert.match(GJC_EGO_BROWSER_UNAVAILABLE_INSTRUCTIONS, /ordinary chat.*continue/iu);
  assert.match(GJC_EGO_BROWSER_UNAVAILABLE_INSTRUCTIONS, /built-in browser.*Aside.*OS browser.*Playwright.*Puppeteer.*MCP.*computer/iu);
  assert.match(GJC_EGO_BROWSER_UNAVAILABLE_INSTRUCTIONS, /import.*upgrade.*onboarding/iu);
});

test('the explicit Ego connection test uses only the absolute CLI and the documented bounded checks', async () => {
  const calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];
  const result = await testEgoBrowserConnection({
    platform: 'darwin', home: '/fixture/home',
    probe: () => ({ ok: true, path: '/fixture/home/.local/bin/ego-browser' }),
    execFile: async (file, args, options) => {
      calls.push({ file, args, options: options as Record<string, unknown> });
      return args[0] === '--version'
        ? { stdout: 'ego-browser 0.5.0.32\n', stderr: '' }
        : { stdout: 'ok\n', stderr: '' };
    },
  });
  assert.deepEqual(result, { ok: true, status: 'connected', cliVersion: '0.5.0.32' });
  assert.deepEqual(calls.map(({ file, args }) => ({ file, args })), [
    { file: '/fixture/home/.local/bin/ego-browser', args: ['--version'] },
    { file: '/fixture/home/.local/bin/ego-browser', args: ['nodejs', '-e', "console.log('ok')"] },
  ]);
  for (const call of calls) {
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout, 2_000);
    assert.deepEqual(call.options.env, {
      HOME: '/fixture/home', PATH: '/fixture/home/.local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
    });
  }
});
