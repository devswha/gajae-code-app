#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { BUN_VERSION } from '../fetch-bun.mjs';

import { assertOutOfTree } from './out-of-tree.mjs';
import { assertWindowsHost, assertWindowsX64Executable, NODE_VERSION, verifyManifest, verifyWindowsSmokeEnvironment, windowsSmokeEnvironment } from './windows-payload.mjs';

export async function runGuardedSmoke({ nodePath, args, cwd, env, jobRuntime, timeoutMs = 120_000, stdout = process.stdout, stderr = process.stderr }) {
  const { createWindowsJobLaunch, killWindowsJobGuard, GJC_WINDOWS_JOB_GUARD_READY, GJC_WINDOWS_JOB_GUARD_ACK } = jobRuntime;
  const launch = createWindowsJobLaunch(nodePath, args, env, cwd);
  const child = spawn(launch.command, launch.args, {
    cwd, env: launch.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let timer;
  let ready = false;
  let buffered = Buffer.alloc(0);
  let diagnostics = '';
  let failure;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    diagnostics = (diagnostics + chunk).slice(-16_384);
    stderr.write(chunk);
  });
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Windows payload smoke timed out.')), timeoutMs);
      child.once('error', reject);
      child.stdin.on('error', reject);
      child.stdout.on('data', chunk => {
        if (ready) { stdout.write(chunk); return; }
        buffered = Buffer.concat([buffered, chunk]);
        const newline = buffered.indexOf(0x0a);
        if (newline < 0 && buffered.length <= 128) return;
        if (newline < 0 || newline > 128 || buffered.subarray(0, newline).toString('utf8').replace(/\r$/, '') !== GJC_WINDOWS_JOB_GUARD_READY) {
          reject(new Error('Windows smoke Job guard did not acknowledge ownership.'));
          return;
        }
        ready = true;
        child.stdin.write(`${GJC_WINDOWS_JOB_GUARD_ACK}\n`);
        stdout.write(buffered.subarray(newline + 1));
        buffered = Buffer.alloc(0);
      });
      child.once('close', code => code === 0 && ready
        ? resolve()
        : reject(new Error(`Windows payload smoke failed (exit ${code}, Job guard ready=${ready}).`)));
    });
  } catch (error) {
    failure = new Error(`${error.message}${diagnostics.trim() ? `\nJob guard diagnostics:\n${diagnostics}` : ''}`);
  } finally {
    clearTimeout(timer);
    // Always reap the named Job, even if its direct child has exited: an early
    // checker exit must not leave a detached server, core, or Bun descendant.
    try { await killWindowsJobGuard(child, launch); }
    catch (error) {
      // execFile errors retain the entire encoded guard command. Report the
      // cleanup reason and native stderr without dumping that command or losing
      // the original startup error underneath it.
      const cause = error.cause;
      const cleanup = new Error(`${error.message}${cause?.killed ? ' (reaper timed out)' : ''}${cause?.stderr ? `\n${String(cause.stderr).slice(-16_384)}` : ''}`);
      failure = failure
        ? new AggregateError([failure, cleanup], `${failure.message}\nJob cleanup also failed: ${cleanup.message}`)
        : cleanup;
    }
  }
  if (failure) throw failure;
}

export async function smokeWindowsServer({ payloadDir, nodePath }) {
  assertWindowsHost();
  if (!payloadDir || !nodePath) throw new Error('Both payloadDir and nodePath are required.');
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-windows smoke 가재-'));
  let failure;
  try {
    await assertOutOfTree(temporaryDir, 'Windows server smoke');
    const payloadCopy = path.join(temporaryDir, 'server payload 가재');
    const runtimeDir = path.join(temporaryDir, 'runtime space 가재');
    const stateDir = path.join(temporaryDir, 'user profile 가재');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(payloadCopy, { recursive: true });
    const env = windowsSmokeEnvironment(runtimeDir, stateDir);
    for (const directory of [stateDir, env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.TEMP, env.WORKSPACES_ROOT, env.GJC_WORKER_AGENT_DIR]) {
      await fs.mkdir(directory, { recursive: true });
    }
    const environment = await verifyWindowsSmokeEnvironment(env, payloadCopy);
    console.log(`Windows smoke environment verified: ${JSON.stringify(environment)}`);
    await fs.cp(path.resolve(payloadDir), payloadCopy, { recursive: true, dereference: false, verbatimSymlinks: true });
    const nodeCopy = path.join(runtimeDir, 'gajae-app-server.exe');
    await fs.copyFile(path.resolve(nodePath), nodeCopy);
    await assertWindowsX64Executable(nodeCopy);
    for (const binary of ['bun.exe', 'gajae-core.exe']) await assertWindowsX64Executable(path.join(payloadCopy, 'dist-native', binary));
    await verifyManifest(payloadCopy);
    const checks = path.join(payloadCopy, '.gajae-windows-smoke.mjs');
    await fs.copyFile(fileURLToPath(new URL('./windows-server-smoke-checks.mjs', import.meta.url)), checks);
    await fs.copyFile(fileURLToPath(new URL('../../src-tauri/src/windows-server-bootstrap.cjs', import.meta.url)),
      path.join(payloadCopy, '.gajae-windows-server-bootstrap.cjs'));
    console.log(`Smoking Windows payload outside the checkout at ${payloadCopy}.`);
    const jobRuntime = await import(pathToFileURL(path.join(payloadCopy, 'dist-server', 'server', 'gjc-windows-job.js')).href);
    await runGuardedSmoke({
      nodePath: nodeCopy, args: [checks, NODE_VERSION, BUN_VERSION], cwd: payloadCopy, env, jobRuntime,
    });
  } catch (error) {
    failure = error;
  } finally {
    try { await fs.rm(temporaryDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) {
      failure = failure
        ? new AggregateError([failure, error], `${failure.message}\nSmoke directory cleanup also failed: ${error.message}`)
        : error;
    }
  }
  if (failure) throw failure;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { payload: { type: 'string' }, node: { type: 'string' } } });
  if (!values.payload || !values.node) throw new Error('Usage: node scripts/release/smoke-windows-server.mjs --payload <dir> --node <sidecar.exe>');
  await smokeWindowsServer({ payloadDir: path.resolve(values.payload), nodePath: path.resolve(values.node) });
}
