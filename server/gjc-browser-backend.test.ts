import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_GJC_BROWSER_BACKEND,
  EGO_VERSION_MATRIX,
  GJC_ASIDE_UNAVAILABLE_CODE,
  GJC_ASIDE_UNAVAILABLE_MESSAGE,
  GJC_BROWSER_BACKENDS,
  GJC_EGO_BROWSER_INSTRUCTIONS,
  GJC_EGO_BROWSER_UNAVAILABLE_INSTRUCTIONS,
  EGO_EXPECTED_BUNDLE_IDENTIFIER,
  GjcAsideUnavailableError,
  buildGjcEgoBrowserInstructions,
  execEgoFile,
  egoBrowserCliCandidates,
  isGjcAsideUnavailableError,
  isGjcBrowserBackend,
  probeEgoBrowserCli,
  probeEgoReadiness,
  testEgoBrowserConnection,
} from './gjc-browser-backend.js';
import { egoActivityToken } from './gjc-ego-activity.js';

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

test('the space naming rule carries only an app-minted token, and an unrecognized one is dropped', () => {
  const token = egoActivityToken('app-session-1');
  const block = buildGjcEgoBrowserInstructions('/fixture/home/.local/bin/ego-browser', token);
  assert.ok(block.includes(`\`"${token} <short goal>"\``));
  assert.match(block, /token is a label only, never something to type into a page/u);

  // Attribution is a display concern; a malformed or injected token never
  // reaches the prompt, and the block stays valid without one.
  for (const rejected of ['gjc-ZZZZZZZZ', 'gjc-123', '"; rm -rf /', 'gjc-12345678 extra', '', undefined]) {
    const plain = buildGjcEgoBrowserInstructions('/fixture/home/.local/bin/ego-browser', rejected);
    assert.equal(plain.includes('Name that space'), false, JSON.stringify(rejected));
    assert.match(plain, /^<browser-backend>\n/u);
    assert.match(plain, /taskSpace\(name\)/u);
  }
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

test('the CLI runner closes stdin, so a CLI that reads its program from stdin cannot hang the app', async (t) => {
  // ego-browser 0.5 waits for EOF on stdin before running a `nodejs` program:
  // with an open stdin pipe every call died on its timeout instead of
  // answering. `cat` stands in for that behaviour without needing ego lite.
  if (process.platform === 'win32') return t.skip('POSIX cat stands in for the CLI');
  const result = await execEgoFile('/bin/cat', [], { timeout: 4_000, maxBuffer: 1024, shell: false });
  assert.equal(String(result.stdout), '');
});

test('a piped ego CLI answers on stderr, and the checks read content rather than the stream', async () => {
  const banner = 'ego-browser 0.5.0.32\n  chromium 152.0.7977.54\n  node v24.18.1\n';
  const connected = await testEgoBrowserConnection({
    platform: 'darwin', home: '/fixture/home',
    probe: () => ({ ok: true, path: '/fixture/home/.local/bin/ego-browser' }),
    // Exactly what ego-browser 0.5.0.32 does when its output is piped.
    execFile: async (_file, args) => (args[0] === '--version'
      ? { stdout: '', stderr: banner }
      : { stdout: '', stderr: 'ok\n' }),
  });
  assert.deepEqual(connected, { ok: true, status: 'connected', cliVersion: '0.5.0.32' });

  // Strictness is kept where it matters: an unindented extra line is something
  // else talking, and is refused instead of being parsed around.
  const noisy = await testEgoBrowserConnection({
    platform: 'darwin', home: '/fixture/home',
    probe: () => ({ ok: true, path: '/fixture/home/.local/bin/ego-browser' }),
    execFile: async () => ({ stdout: '', stderr: `${banner}update required\n` }),
  });
  assert.equal(noisy.ok, false);
  assert.equal(noisy.errorCode, 'ego_connection_failed');
});

test('the explicit connection test rejects an unsupported known CLI version before nodejs', async () => {
  const calls: string[][] = [];
  const result = await testEgoBrowserConnection({
    platform: 'darwin',
    probe: () => ({ ok: true, path: '/fixture/ego-browser' }),
    execFile: async (_file, args) => {
      calls.push([...args]);
      return { stdout: 'ego-browser 99.0.0.0\n', stderr: '' };
    },
  });
  assert.equal(EGO_VERSION_MATRIX.cli.supported.includes('99.0.0.0'), false);
  assert.deepEqual(result, {
    ok: false,
    status: 'failed',
    errorCode: 'ego_version_unsupported',
    message: 'The installed ego-browser CLI version is not supported.',
    cliVersion: '99.0.0.0',
  });
  assert.deepEqual(calls, [['--version']]);
});

test('readiness rejects a CLI symlink to a directory and cross-checks the active app plist', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ego-readiness-'));
  try {
    const cliDir = join(home, 'cli-target');
    await mkdir(cliDir);
    const cliPath = join(home, '.local', 'bin', 'ego-browser');
    await mkdir(join(home, '.local', 'bin'), { recursive: true });
    await symlink(cliDir, cliPath);

    const activePath = join(home, '.local', 'share', 'ego', 'ego lite.app', 'Contents', 'Frameworks', 'ego Framework.framework', 'Versions', '0.5.0.32');
    await mkdir(activePath, { recursive: true });
    await symlink(activePath, join(home, '.local', 'share', 'ego', 'active_version_dir'));
    await writeFile(join(home, '.local', 'share', 'ego', 'ego lite.app', 'Contents', 'Info.plist'), [
      '<plist><dict>',
      '<key>CFBundleIdentifier</key><string>com.example.untrusted</string>',
      '<key>CFBundleShortVersionString</key><string>0.5.0.31</string>',
      '</dict></plist>',
    ].join(''));
    const agentDir = join(home, 'custom-agent');
    await mkdir(join(agentDir, 'skills', 'ego-browser'), { recursive: true });
    await writeFile(join(agentDir, 'skills', 'ego-browser', 'SKILL.md'), '---\nversion: 2.0.0\n---\n');

    const report = probeEgoReadiness({ home, agentDir, platform: 'darwin', path: '' });
    assert.equal(report.cli.state, 'not_executable');
    assert.equal(report.checks.ego_cli_not_executable.state, 'problem');
    assert.equal(report.checks.ego_app_version_mismatch.state, 'problem');
    assert.equal(report.checks.ego_app_untrusted.state, 'problem');
    assert.equal(report.versions.app, '0.5.0.32');
    assert.equal(report.appMetadata.version, '0.5.0.31');
    assert.equal(report.appMetadata.bundleIdentifier, 'com.example.untrusted');
    assert.equal(JSON.stringify(report).includes(home), false);
    assert.equal(EGO_EXPECTED_BUNDLE_IDENTIFIER, 'com.citrolabs.ego.lite');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
