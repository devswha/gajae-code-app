import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';

import { verifyWindowsSmokeEnvironment, windowsSmokeEnvironment } from './windows-payload.mjs';

test('isolated Windows environment retains OS/compiler metadata and isolates all writable user paths', () => {
  const profile = String.raw`C:\Users\runner\smoke 사용자 profile`;
  const env = windowsSmokeEnvironment(String.raw`C:\runtime 가재`, profile, {
    windir: String.raw`C:\Windows`, programfiles: String.raw`C:\Program Files`,
    'PROGRAMFILES(X86)': String.raw`C:\Program Files (x86)`, ProgramData: String.raw`C:\ProgramData`,
    USERNAME: 'runner', USERDOMAIN: 'test-machine', COMPUTERNAME: 'test-machine',
    HOME: 'private-home', USERPROFILE: 'private-home', TEMP: 'private-temp', APPDATA: 'private-appdata',
    PSModulePath: 'private-powershell-modules', NODE_OPTIONS: '--require private.js',
    OPENAI_API_KEY: 'do-not-inherit', ANTHROPIC_API_KEY: 'do-not-inherit',
  });
  assert.equal(env.SystemRoot, String.raw`C:\Windows`);
  assert.equal(env.WINDIR, env.SystemRoot);
  assert.equal(env.ComSpec, String.raw`C:\Windows\System32\cmd.exe`);
  assert.equal(env.ProgramFiles, String.raw`C:\Program Files`);
  assert.equal(env['ProgramFiles(x86)'], String.raw`C:\Program Files (x86)`);
  assert.equal(env.USERNAME, 'runner');
  assert.equal(env.USERDOMAIN, 'test-machine');
  assert.equal(env.PSModulePath, String.raw`C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`);
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'DATABASE_PATH', 'GJC_WORKER_AGENT_DIR']) {
    assert.ok(env[key].startsWith(profile), `${key} must preserve the isolated Unicode profile`);
  }
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
});

test('Add-Type probe compresses its source below Windows command limits and returns native evidence', async () => {
  const env = windowsSmokeEnvironment(String.raw`C:\runtime 가재`, String.raw`C:\profile 가재`);
  const cwd = String.raw`C:\payload space 가재`;
  const native = { runtime: String.raw`C:\Windows\Microsoft.NET\Framework64\v4.0.30319`, temp: env.TEMP, compilerExists: true, tempExists: true };
  const actual = await verifyWindowsSmokeEnvironment(env, cwd, {
    execute: async (_command, args, options) => {
      assert.ok(args.includes('-EncodedCommand'));
      assert.ok(args.join(' ').length < 30_000, 'probe must fit CreateProcess command-line limits');
      const loader = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      const compressed = loader.match(/FromBase64String\('([^']+)'\)/)?.[1];
      assert.ok(compressed);
      const source = gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
      assert.match(source, /Add-Type -CompilerParameters \$compilerParameters -TypeDefinition/);
      assert.match(source, /GetTempPath/);
      assert.match(source, /GetRuntimeDirectory/);
      assert.ok(!source.includes(cwd));
      assert.equal(options.env, env);
      assert.equal(options.cwd, cwd);
      assert.equal(options.shell, false);
      return { stdout: `${JSON.stringify(native)}\n{"compiled":42}\n`, stderr: '' };
    },
  });
  assert.deepEqual(actual, native);
  await assert.rejects(verifyWindowsSmokeEnvironment(env, cwd, {
    execute: async () => { throw Object.assign(new Error('encoded-command-must-not-appear'), {
      cmd: 'encoded-command-must-not-appear', code: 1, stdout: JSON.stringify(native), stderr: 'Add-Type Win32Exception: invalid path',
    }); },
  }), error => {
    assert.match(error.message, /Add-Type Win32Exception: invalid path/);
    assert.match(error.message, /Framework64/);
    assert.ok(!error.message.includes('encoded-command-must-not-appear'));
    return true;
  });
});

test('Windows raw mandatory ACE validator handles labels independently of SDDL formatting', {
  skip: process.platform !== 'win32', timeout: 45_000,
}, async () => {
  const { tsImport } = await import('tsx/esm/api');
  const { windowsCodeDomLabelValidationScript } = await tsImport(new URL('../../server/gjc-windows-job.ts', import.meta.url).href, import.meta.url);
  const cases = [
    { name: 'high', sddl: 'S:(ML;OI;NW;;;HI)', expected: true, count: 1 },
    { name: 'numeric high SID', sddl: 'S:(ML;OICI;NW;;;S-1-16-12288)', expected: true, count: 1 },
    { name: 'additional restrictions', sddl: 'S:(ML;OI;NWNR;;;HI)', expected: true, count: 1 },
    { name: 'medium', sddl: 'S:(ML;OI;NW;;;ME)', expected: false, count: 1 },
    { name: 'missing no-write-up', sddl: 'S:(ML;OI;NR;;;HI)', expected: false, count: 1 },
    { name: 'inherit-only', sddl: 'S:(ML;OIIO;NW;;;HI)', expected: false, count: 1 },
    { name: 'missing SACL', sddl: 'D:(A;;FA;;;BA)', expected: false, count: 0 },
    { name: 'empty SACL', sddl: 'D:(A;;FA;;;BA)S:AI', expected: false, count: 0 },
    { name: 'audit ACE is not a label', sddl: 'S:(AU;SA;FA;;;S-1-16-12288)', expected: false, count: 1 },
  ];
  const source = `$ErrorActionPreference = 'Stop'
${windowsCodeDomLabelValidationScript()}
foreach ($case in ($env:GAJAE_LABEL_FIXTURES | ConvertFrom-Json)) {
    $state = Get-GajaeCompilerLabelState ([Security.AccessControl.RawSecurityDescriptor]::new($case.sddl))
    [Console]::Out.WriteLine((@{ name = $case.name; valid = $state.hasHighLabel; count = $state.saclCount; aces = $state.aces } | ConvertTo-Json -Compress -Depth 4))
}`;
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const { stdout } = await promisify(execFile)(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64'),
  ], { env: { ...process.env, GAJAE_LABEL_FIXTURES: JSON.stringify(cases) }, windowsHide: true, shell: false, timeout: 30_000 });
  const results = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(results.map(({ name, valid, count }) => ({ name, valid, count })),
    cases.map(({ name, expected, count }) => ({ name, valid: expected, count })));
  assert.deepEqual(results[0].aces, [{ type: 0x11, size: 20, flags: 1, mask: 1, sid: 'S-1-16-12288' }]);
});

test('Windows compiler path policy accepts only ASCII aliases of the same protected directory', {
  skip: process.platform !== 'win32', timeout: 45_000,
}, async () => {
  const { tsImport } = await import('tsx/esm/api');
  const { windowsCodeDomPathValidationScript } = await tsImport(new URL('../../server/gjc-windows-job.ts', import.meta.url).href, import.meta.url);
  const original = String.raw`C:\private 가재\compiler`;
  const cases = [
    { name: 'verified alias', original, alias: String.raw`C:\PRIVAT~1\compiler`, resolved: original, valid: true },
    { name: 'case-insensitive round trip', original, alias: String.raw`C:\PRIVAT~1\compiler`, resolved: String.raw`c:\PRIVATE 가재\COMPILER`, valid: true },
    { name: 'short names unavailable', original, alias: original, resolved: original, valid: false },
    { name: 'empty alias', original, alias: '', resolved: original, valid: false },
    { name: 'relative alias', original, alias: 'PRIVAT~1', resolved: original, valid: false },
    { name: 'different target', original, alias: String.raw`C:\PRIVAT~1\compiler`, resolved: String.raw`C:\another\compiler`, valid: false },
  ];
  const source = `$ErrorActionPreference = 'Stop'
${windowsCodeDomPathValidationScript()}
foreach ($case in ($env:GAJAE_PATH_FIXTURES | ConvertFrom-Json)) {
    try { $null = Assert-GajaeCompilerPath $case.original $case.alias $case.resolved; $valid = $true; $reason = '' }
    catch { $valid = $false; $reason = $_.Exception.Message }
    [Console]::Out.WriteLine((@{ name = $case.name; valid = $valid; reason = $reason } | ConvertTo-Json -Compress))
}`;
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const { stdout } = await promisify(execFile)(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64'),
  ], { env: { ...process.env, GAJAE_PATH_FIXTURES: JSON.stringify(cases) }, windowsHide: true, shell: false, timeout: 30_000 });
  const results = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(results.map(({ name, valid }) => ({ name, valid })), cases.map(({ name, valid }) => ({ name, valid })));
  assert.match(results[2].reason, /short-name generation may be disabled/);
  assert.match(results[5].reason, /same protected directory/);
});

test('real Windows Add-Type works with baseline and isolated Unicode profile, cwd and temp', {
  skip: process.platform !== 'win32', timeout: 140_000,
}, async t => {
  // No Bun, core, native addon or compiled server is needed: run this before
  // the expensive packaging build. Only the constant Add-Type probe runs;
  // neither case loads a PowerShell profile or application credentials.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae Add-Type 가재 space-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const cwd = path.join(root, 'payload cwd 가재');
  const env = windowsSmokeEnvironment(path.dirname(process.execPath), path.join(root, 'profile 사용자'));
  for (const directory of [cwd, env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA, env.TEMP,
    env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.GJC_WORKER_AGENT_DIR, env.WORKSPACES_ROOT]) {
    await fs.mkdir(directory, { recursive: true });
  }
  const failures = [];
  for (const [label, candidate] of [
    ['baseline', { ...process.env, SystemRoot: env.SystemRoot }],
    ['isolated Unicode', env],
  ]) {
    try {
      const result = await verifyWindowsSmokeEnvironment(candidate, cwd);
      t.diagnostic(`${label}: ${JSON.stringify(result)}`);
      assert.equal(result.compilerExists, true);
      assert.equal(result.tempExists, true);
      assert.ok(result.runtime);
      assert.ok(path.resolve(result.compilerTemp).startsWith(path.resolve(result.temp) + path.sep));
      assert.equal(result.compilerPathVerified, true);
      assert.equal(path.resolve(result.compilerLongPath).toLowerCase(), path.resolve(result.compilerTemp).toLowerCase());
      assert.match(result.compilerPath, /^[\x20-\x7e]+$/);
      assert.ok(result.compilerBasePath.startsWith(result.compilerPath + path.sep));
      assert.ok(result.compilerOutputAssembly.startsWith(result.compilerPath + path.sep));
      assert.equal(result.compilerEnvironmentRestored, true);
      assert.equal(result.compilerRestoredTemp, candidate.TEMP);
      assert.equal(result.compilerRestoredTmp, candidate.TMP);
      if (result.elevated) {
        assert.match(result.compilerSddl, /\(D;OI;SD;;;/);
        assert.match(result.compilerSddl, /\(A;OICI;FA;;;BA\)/);
        assert.equal(result.hasHighLabel, true);
        assert.ok(result.compilerSaclCount > 0);
        assert.ok(result.compilerSaclAces.some(ace => ace.type === 0x11
          && ace.sid === 'S-1-16-12288' && (ace.mask & 1) !== 0 && (ace.flags & 8) === 0));
      }
      await assert.rejects(fs.access(result.compilerTemp), { code: 'ENOENT' });
      if (label === 'isolated Unicode') {
        assert.equal(await fs.realpath(result.temp), await fs.realpath(env.TEMP));
        assert.equal(path.resolve(result.userProfile).toLowerCase(), path.resolve(env.USERPROFILE).toLowerCase());
      }
    } catch (error) {
      t.diagnostic(`${label}: ${error.message}`);
      failures.push(new Error(`${label}: ${error.message}`));
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Windows .NET/Add-Type environment preflight failed; inspect baseline versus isolated diagnostics.');
});
