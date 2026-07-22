import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  createWindowsJobLaunch,
  GJC_WINDOWS_JOB_GUARD_ACK,
  GJC_WINDOWS_JOB_GUARD_READY,
  quoteWindowsArgument,
} from './gjc-windows-job.js';

test('quotes Windows argv values without losing quotes or trailing slashes', () => {
  assert.equal(quoteWindowsArgument('plain'), 'plain');
  assert.equal(quoteWindowsArgument(''), '""');
  assert.equal(quoteWindowsArgument('with space'), '"with space"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(
    quoteWindowsArgument('C:\\path with space\\'),
    '"C:\\path with space\\\\"',
  );
});

test('builds a guard that atomically creates the worker inside a Windows job', () => {
  const launch = createWindowsJobLaunch(
    'C:\\Program Files\\node.exe',
    ['C:\\work dir\\gjc-worker.js'],
    { SystemRoot: 'C:\\Windows', KEEP_ME: 'yes' },
    'C:\\work dir',
  );

  assert.equal(
    launch.command,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.deepEqual(launch.args.slice(0, -1), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
  ]);
  assert.ok(launch.args.join(' ').length < 30_000);
  const loader = Buffer.from(launch.args.at(-1)!, 'base64').toString('utf16le');
  const compressed = loader.match(/FromBase64String\('([^']+)'\)/u)?.[1];
  assert.ok(compressed);
  const script = gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
  assert.match(script, /EXTENDED_STARTUPINFO_PRESENT/);
  assert.match(script, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(script, /PROC_THREAD_ATTRIBUTE_JOB_LIST/);
  assert.match(script, /InitializeProcThreadAttributeList/);
  assert.match(script, /UpdateProcThreadAttribute/);
  assert.match(script, /WaitForMultipleObjects/);
  assert.match(script, /ReadFile/);
  assert.doesNotMatch(script, /Console\]::In/);
  assert.match(script, new RegExp(GJC_WINDOWS_JOB_GUARD_READY));
  assert.match(script, new RegExp(GJC_WINDOWS_JOB_GUARD_ACK));
  assert.ok(
    script.indexOf('$ownerHandle = [GajaeWindowsJobGuard]::OpenOwner')
      < script.indexOf(`[Console]::Out.WriteLine('${GJC_WINDOWS_JOB_GUARD_READY}')`),
  );
  assert.ok(
    script.indexOf(`ReadAcknowledgement('${GJC_WINDOWS_JOB_GUARD_ACK}')`)
      < script.indexOf('$exitCode = [GajaeWindowsJobGuard]::Run'),
  );
  assert.equal(launch.env.KEEP_ME, 'yes');
  assert.equal(
    launch.env.GAJAE_INTERNAL_JOB_OWNER_PROCESS,
    String(process.pid),
  );
  assert.equal(
    launch.env.GAJAE_INTERNAL_JOB_COMMAND_LINE,
    '"C:\\Program Files\\node.exe" "C:\\work dir\\gjc-worker.js"',
  );
});
