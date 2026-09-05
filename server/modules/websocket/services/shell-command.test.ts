import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildGjcShellCommand, buildShellEnvironment, buildShellLaunch } from './shell-command.js';

const windows = {
  platform: 'win32' as const,
  home: 'C:\\Users\\Test User',
  execPath: 'C:\\Program Files\\Gajae\\node.exe',
  isDirectory: () => false,
};

test('Windows PATH merges casing aliases, promotes npm, and preserves other search directories', () => {
  const env = {
    Path: 'C:\\Windows\\System32;"c:\\users\\test user\\appdata\\roaming\\npm\\";D:\\Tools',
    PATH: 'D:\\Other;C:\\WINDOWS\\system32',
    APPDATA: 'C:\\Users\\Test User\\AppData\\Roaming',
    SYSTEMROOT: 'C:\\Windows',
    KEEP_ME: 'value',
  };
  const result = buildShellEnvironment(env, windows);
  assert.equal(result.PATH, 'C:\\Users\\Test User\\AppData\\Roaming\\npm;C:\\Windows\\System32;D:\\Tools;D:\\Other');
  assert.deepEqual(Object.keys(result).filter((key) => key.toLowerCase() === 'path'), ['PATH']);
  assert.equal(result.KEEP_ME, 'value');
  assert.equal(env.PATH, 'D:\\Other;C:\\WINDOWS\\system32', 'the server environment must not be mutated');
});

test('Windows GUI launches recover existing npm, node and system directories absent from PATH', () => {
  const directories = new Set(['D:\\Npm Prefix', 'C:\\Users\\Test User\\AppData\\Roaming\\npm', 'C:\\Program Files\\Gajae', 'C:\\Windows\\System32']);
  const result = buildShellEnvironment({ npm_config_prefix: 'D:\\Npm Prefix', Path: 'D:\\Other' }, {
    ...windows, isDirectory: (directory) => directories.has(directory),
  });
  assert.equal(result.PATH, [...directories, 'D:\\Other'].join(';'));
  assert.ok(!result.PATH.includes('D:\\Npm Prefix\\bin'), 'Windows npm puts its shims in the prefix itself');
  assert.deepEqual([result.TERM, result.COLORTERM, result.FORCE_COLOR], ['xterm-256color', 'truecolor', '3']);
});

test('Windows PATH repairs an empty environment without adding missing or relative npm directories', () => {
  for (const env of [{}, { Path: '' }, { PATH: '', Path: 'D:\\Tools' }]) {
    const result = buildShellEnvironment({ ...env, NPM_CONFIG_PREFIX: 'relative-prefix' }, {
      ...windows, isDirectory: (directory) => directory === 'C:\\Program Files\\Gajae',
    });
    assert.equal(result.PATH, ['C:\\Program Files\\Gajae', ...('Path' in env && env.Path ? [env.Path] : [])].join(';'));
  }
});

test('POSIX PATH is case-sensitive and uses colon-separated npm bin directories', () => {
  const result = buildShellEnvironment({ Path: 'do-not-use', PATH: '/usr/bin:/opt/npm/bin:/extra', npm_config_prefix: '/opt/npm' }, {
    platform: 'linux', home: '/home/test', isDirectory: () => { throw new Error('must not probe Windows directories'); },
  });
  assert.equal(result.PATH, '/opt/npm/bin:/usr/bin:/extra');
  assert.equal(result.Path, 'do-not-use');
  const unchanged = { PATH: '/usr/bin::/bin:/usr/bin' };
  assert.equal(buildShellEnvironment(unchanged, { platform: 'linux', home: '/home/test' }).PATH, unchanged.PATH);
});

test('Windows provider launch selects the npm cmd shim and keeps its path outside PowerShell syntax', () => {
  const directory = "C:\\Users\\O'Brien & ‘한글’\\AppData\\Roaming\\npm";
  const shim = path.win32.join(directory, 'gjc.cmd');
  const command = buildGjcShellCommand('native-session.1:2', { PATH: directory }, { platform: 'win32', isFile: (file) => file === shim });
  const literals = [...command.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)];
  assert.equal(literals.length, 2);
  for (const match of literals) assert.equal(Buffer.from(match[1], 'base64').toString('utf8'), shim);
  assert.match(command, / --resume 'native-session\.1:2'; if \(-not \$\?\) \{ & /);
  assert.doesNotMatch(command, /\|\||\.ps1|LASTEXITCODE/);
});

test('Windows provider executable resolution respects PATH order and avoids relative directories', () => {
  const seen: string[] = [];
  const command = buildGjcShellCommand('', { PATH: '.;relative;"D:\\First";D:\\Second' }, {
    platform: 'win32', isFile: (file) => { seen.push(file); return file.endsWith('.cmd'); },
  });
  assert.deepEqual(seen, ['D:\\First\\gjc.exe', 'D:\\First\\gjc.cmd']);
  const match = command.match(/FromBase64String\('([^']+)'\)/);
  assert.ok(match);
  assert.equal(Buffer.from(match[1], 'base64').toString('utf8'), 'D:\\First\\gjc.cmd');
  assert.doesNotMatch(command, /resume|if \(/);
});

test('provider-generated resume commands reject executable syntax in native IDs', () => {
  for (const platform of ['win32', 'linux'] as const) {
    for (const sessionId of ["id'; calc; '", 'id$(calc)', 'id&calc', 'id%PATH%', 'id\ncalc', 'id"']) {
      assert.throws(() => buildGjcShellCommand(sessionId, {}, { platform }), /Invalid provider session ID/);
    }
  }
  assert.equal(buildGjcShellCommand('native-id', {}, { platform: 'linux' }), 'gjc --resume "native-id" || gjc');
  assert.equal(buildGjcShellCommand('', {}, { platform: 'darwin' }), 'gjc');
});

test('Windows shell commands survive argv transport with Unicode, quotes and PowerShell expressions', () => {
  const command = '& "C:\\Program Files\\tool.exe" "한글"; Write-Output \'$env:PATH & literal\'';
  const launch = buildShellLaunch(command, { systemroot: 'D:\\Windows' }, 'win32');
  assert.equal(launch.executable, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(launch.args.slice(0, -1), ['-NoLogo', '-NoProfile', '-EncodedCommand']);
  assert.equal(Buffer.from(launch.args.at(-1)!, 'base64').toString('utf16le'), command);
});

test('empty shell requests open an interactive prompt on Windows and POSIX', () => {
  for (const command of ['', ' \t\r\n']) {
    assert.deepEqual(buildShellLaunch(command, {}, 'win32').args, ['-NoLogo', '-NoProfile']);
    assert.deepEqual(buildShellLaunch(command, {}, 'linux'), { executable: 'bash', args: ['-i'] });
  }
  assert.deepEqual(buildShellLaunch('printf "%s" "$HOME"', {}, 'linux'), { executable: 'bash', args: ['-c', 'printf "%s" "$HOME"'] });
});

test('native Windows PowerShell runs npm cmd shims and falls back only after a failed resume', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gajae-shell-'));
  const bin = path.join(directory, "O'Brien & 한글");
  mkdirSync(bin);
  const log = path.join(directory, 'calls.txt');
  writeFileSync(path.join(bin, 'gjc.cmd'), '@echo off\r\necho [%*]>>"%GAJAE_SHELL_TEST_LOG%"\r\nif "%~1"=="--resume" exit /b %GAJAE_SHELL_RESUME_STATUS%\r\nexit /b 0\r\n');
  writeFileSync(path.join(bin, 'gjc.ps1'), 'throw "The npm PowerShell shim must not run"');
  try {
    const env = buildShellEnvironment({ ...process.env, npm_config_prefix: bin, GAJAE_SHELL_TEST_LOG: log });
    for (const code of ['0', '7']) {
      writeFileSync(log, '');
      const launch = buildShellLaunch(buildGjcShellCommand('native-id', env), env);
      execFileSync(launch.executable, launch.args, { env: { ...env, GAJAE_SHELL_RESUME_STATUS: code }, timeout: 15000 });
      assert.deepEqual(readFileSync(log, 'utf8').trim().split(/\r?\n/), code === '0' ? ['[--resume native-id]'] : ['[--resume native-id]', '[]']);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
