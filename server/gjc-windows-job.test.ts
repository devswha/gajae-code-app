import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  createWindowsJobLaunch,
  killWindowsJobGuard,
  GJC_WINDOWS_JOB_GUARD_ACK,
  GJC_WINDOWS_JOB_GUARD_READY,
  quoteWindowsArgument,
  windowsCodeDomCompileScript,
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

test('CodeDom compilation uses explicit private temp files with the original elevated protections', () => {
  const script = windowsCodeDomCompileScript('public class PrivateCompilerFixture {}');
  assert.match(script, /\[GajaeCodeDomFileApi\]::CreateDirectoryW\(\$compilerTemp, \$compilerAttributesPointer\)/);
  assert.match(script, /RawSecurityDescriptor\]::new\(\$compilerSddl\)/);
  assert.match(script, /GetField\('SetLastError'\)/);
  assert.match(script, /CharSet\]::Unicode/);
  assert.match(script, /GetFileSecurityW\(\$compilerTemp, 0x14/);
  assert.match(script, /D:\(D;OI;SD;;;/);
  assert.match(script, /\(A;OICI;FA;;;BA\)S:\(ML;OI;NW;;;HI\)/);
  assert.match(script, /GenerateInMemory = \$true/);
  assert.match(script, /'System.dll', 'System.Core.dll'/);
  assert.match(script, /TempFileCollection\]::new\(\$compilerTemp, \$false\)/);
  assert.match(script, /Add-Type -CompilerParameters \$compilerParameters/);
  assert.doesNotMatch(script, /DisableTempFileCollectionDirectoryFeature|SetSwitch|junction|ShortPath/i);
  assert.ok(script.indexOf('GetBinaryForm($compilerDescriptorBytes, 0)') < script.indexOf('[GajaeCodeDomFileApi]::CreateDirectoryW'));
  assert.ok(script.indexOf('[IO.Directory]::SetAccessControl') < script.indexOf('$compilerParameters.TempFiles.Delete()'));
  assert.ok(script.indexOf('$compilerParameters.TempFiles.Delete()') < script.indexOf('[IO.Directory]::Delete'));
});

test('generated PowerShell label regex matches SDDL and diagnostics precede rejection', () => {
  const diagnosticScript = windowsCodeDomCompileScript('public class LabelRegexFixture {}', true);
  const launch = createWindowsJobLaunch('node.exe', [], { SystemRoot: 'C:\\Windows' }, 'C:\\');
  const loader = Buffer.from(launch.args.at(-1)!, 'base64').toString('utf16le');
  const compressed = loader.match(/FromBase64String\('([^']+)'\)/u)?.[1];
  assert.ok(compressed);
  const guardScript = gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
  for (const script of [diagnosticScript, guardScript]) {
    const pattern = script.match(/\$compilerActualSddl -notmatch '([^']+)'/u)?.[1];
    assert.equal(pattern, String.raw`\(ML;[^;]*;NW;;;HI\)`);
    const regex = new RegExp(pattern!);
    for (const high of ['S:(ML;OI;NW;;;HI)', 'D:(A;OICI;FA;;;BA)S:(ML;;NW;;;HI)', 'S:(ML;OICI;NW;;;HI)']) {
      assert.equal(regex.test(high), true, high);
    }
    for (const rejected of ['S:(ML;OI;NW;;;ME)', 'D:(A;OICI;FA;;;BA)', 'S:(ML;OI;NR;;;HI)']) {
      assert.equal(regex.test(rejected), false, rejected);
    }
    assert.match(script, /requestedCompilerSddl = \$compilerSddl; compilerSddl = \$compilerActualSddl/);
    assert.match(script, /high-integrity label was not preserved\. ' \+ \$compilerSecurityReport/);
  }
  assert.ok(diagnosticScript.indexOf('[Console]::Out.WriteLine($compilerSecurityReport)')
    < diagnosticScript.indexOf('$compilerActualSddl -notmatch'));
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
  assert.match(script, /CreateJobObject\(IntPtr.Zero, jobName\)/);
  assert.match(script, /TerminateJobObject/);
  assert.match(script, /QueryInformationJobObject/);
  assert.match(script, /accounting.ActiveProcesses == 0/);
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
  assert.match(launch.jobName, /^Local\\gajae-worker-[a-f0-9-]+$/);
  assert.equal(launch.env.GAJAE_INTERNAL_JOB_NAME, launch.jobName);
  assert.equal(
    launch.env.GAJAE_INTERNAL_JOB_OWNER_PROCESS,
    String(process.pid),
  );
  assert.equal(
    launch.env.GAJAE_INTERNAL_JOB_COMMAND_LINE,
    '"C:\\Program Files\\node.exe" "C:\\work dir\\gjc-worker.js"',
  );
});

test('each Windows worker owns a separate named job and accepts Windows environment casing', () => {
  const first = createWindowsJobLaunch('node.exe', [], { SYSTEMROOT: 'C:\\Windows' }, 'C:\\work');
  const second = createWindowsJobLaunch('node.exe', [], { windir: 'C:\\Windows' }, 'C:\\work');
  assert.equal(first.command, second.command);
  assert.notEqual(first.jobName, second.jobName);
  assert.throws(() => createWindowsJobLaunch('node.exe', [], {}, 'C:\\work'), /SystemRoot/);
});

test('Windows reap barrier waits for guard exit and independent Job Object verification', async () => {
  const launch = createWindowsJobLaunch('node.exe', [], { SystemRoot: 'C:\\Windows' }, 'C:\\work');
  const child = Object.assign(new EventEmitter(), { kill: (signal: string) => {
    assert.equal(signal, 'SIGKILL');
    return true;
  } });
  let queried = false;
  let release!: () => void;
  const verification = new Promise<void>((resolve) => { release = resolve; });
  const reap = killWindowsJobGuard(child, launch, async (owned) => {
    assert.equal(owned.jobName, launch.jobName);
    queried = true;
    await verification;
  });
  let settled = false;
  void reap.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queried, false);
  child.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queried, true);
  assert.equal(settled, false);
  release();
  await reap;
});

test('Windows reap barrier rejects termination and verification failures', async () => {
  const launch = createWindowsJobLaunch('node.exe', [], { SystemRoot: 'C:\\Windows' }, 'C:\\work');
  const alive = Object.assign(new EventEmitter(), { kill: () => false });
  await assert.rejects(killWindowsJobGuard(alive, launch, async () => { assert.fail('guard is still alive'); }), /could not be terminated/);
  const exited = Object.assign(new EventEmitter(), { exitCode: 0, kill: () => { assert.fail('already exited'); } });
  await assert.rejects(killWindowsJobGuard(exited, launch, async () => { throw new Error('job query failed'); }), /job query failed/);
});

for (const shutdown of ['guard', 'owner'] as const) {
test(`Windows Job Object kills detached descendants after ${shutdown} exit`, {
  // Startup (15 s), owner exit (5 s), and two independent reaps (up to 20 s
  // each) have separate bounds. Do not cancel a still-bounded reap on CI.
  skip: process.platform !== 'win32', timeout: 65_000,
}, async () => {
  const program = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    child.on('spawn', () => {
      const frame = Buffer.from(JSON.stringify({ descendant: child.pid, marker: '가재 job fixture' }) + '\\n');
      const split = frame.indexOf(Buffer.from('가')) + 1;
      process.stdout.write(frame.subarray(0, split));
      setTimeout(() => process.stdout.write(frame.subarray(split)), 10);
    });
    setInterval(() => {}, 1000);
  `;
  const owner = shutdown === 'owner'
    ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    : undefined;
  const launch = createWindowsJobLaunch(process.execPath, ['-e', program], process.env, process.cwd());
  if (owner) launch.env.GAJAE_INTERNAL_JOB_OWNER_PROCESS = String(owner.pid);
  const guard = spawn(launch.command, launch.args, { env: launch.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const guardClosed = new Promise<void>((resolve) => guard.once('close', () => resolve()));
  const ownerClosed = owner ? new Promise<void>((resolve) => owner.once('close', () => resolve())) : Promise.resolve();
  let stderr = '';
  guard.stderr.setEncoding('utf8');
  guard.stderr.on('data', (chunk: string) => { stderr += chunk; });
  guard.stdout.setEncoding('utf8');
  let descendant: number | undefined;
  try {
    descendant = await new Promise<number>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error(`Job guard startup timed out: ${stderr}`)), 15_000);
      guard.once('error', (error) => { clearTimeout(timer); reject(error); });
      guard.once('exit', () => { clearTimeout(timer); reject(new Error(`Job guard exited: ${stderr}`)); });
      guard.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const raw of lines) {
          const line = raw.replace(/\r$/u, '');
          if (line === GJC_WINDOWS_JOB_GUARD_READY) guard.stdin.write(`${GJC_WINDOWS_JOB_GUARD_ACK}\n`);
          else {
            try {
              const frame = JSON.parse(line) as { descendant: number; marker: string };
              assert.ok(frame.descendant > 0);
              assert.equal(frame.marker, '가재 job fixture');
              clearTimeout(timer);
              resolve(frame.descendant);
            } catch (error) { clearTimeout(timer); reject(error); }
          }
        }
      });
    });
    process.kill(descendant, 0);
    if (owner) {
      // Killing the app owner must cause the guard itself to exit. Do not call
      // the explicit reaper until that independent lifecycle has completed.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Guard survived owner exit.')), 5_000);
        guard.once('exit', () => { clearTimeout(timer); resolve(); });
        owner.kill('SIGKILL');
      });
    }
    await killWindowsJobGuard(guard, launch);
    assert.throws(() => process.kill(descendant!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
    // Reaping a generation that already exited is idempotent.
    await killWindowsJobGuard(guard, launch);
  } finally {
    if (guard.exitCode === null && guard.signalCode === null) guard.kill('SIGKILL');
    if (owner && owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch { /* already reaped */ } }
    await Promise.all([guardClosed, ownerClosed]);
  }
});
}
