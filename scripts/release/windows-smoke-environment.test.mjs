import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('Add-Type probe uses constant UTF-16LE encoded source and returns bounded native evidence', async () => {
  const env = windowsSmokeEnvironment(String.raw`C:\runtime 가재`, String.raw`C:\profile 가재`);
  const cwd = String.raw`C:\payload space 가재`;
  const native = { runtime: String.raw`C:\Windows\Microsoft.NET\Framework64\v4.0.30319`, temp: env.TEMP, compilerExists: true, tempExists: true };
  const actual = await verifyWindowsSmokeEnvironment(env, cwd, {
    execute: async (_command, args, options) => {
      assert.ok(args.includes('-EncodedCommand'));
      const source = Buffer.from(args.at(-1), 'base64').toString('utf16le');
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
      if (result.elevated) {
        assert.match(result.compilerSddl, /\(D;OI;SD;;;/);
        assert.match(result.compilerSddl, /\(A;OICI;FA;;;BA\)/);
        assert.match(result.compilerSddl, /\(ML;[^;]*;NW;;;HI\)/);
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
