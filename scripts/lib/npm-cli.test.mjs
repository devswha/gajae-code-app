import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { npmInvocation } from './npm-cli.mjs';

test('Windows npm uses Node with literal paths and arguments', () => {
  const cli = String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`;
  const execPath = String.raw`C:\Program Files\nodejs\node.exe`;
  const args = ['pack', '--pack-destination', String.raw`C:\Users\가재 & dev\build %temp%`];
  assert.deepEqual(npmInvocation(args, {
    env: {}, platform: 'win32', execPath, exists: candidate => candidate === cli,
  }), { command: execPath, args: [cli, ...args] });
});

test('npm run entrypoint takes precedence over adjacent installations', () => {
  const cli = String.raw`D:\tools\npm\bin\npm-cli.js`;
  const invocation = npmInvocation(['audit', '--json'], {
    env: { npm_execpath: cli }, platform: 'win32',
    execPath: String.raw`C:\node\node.exe`, exists: () => true,
  });
  assert.equal(invocation.args[0], cli);
});

test('missing npm on Windows gives an actionable error without invoking a shell', () => {
  assert.throws(() => npmInvocation(['ci'], {
    env: {}, platform: 'win32', execPath: String.raw`C:\node\node.exe`, exists: () => false,
  }), /Could not locate npm-cli.js/);
});

test('npm invocation runs the installed CLI', () => {
  const npm = npmInvocation(['--version']);
  const result = spawnSync(npm.command, npm.args, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
