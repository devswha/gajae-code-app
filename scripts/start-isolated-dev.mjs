import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { npmInvocation } from './lib/npm-cli.mjs';

const SAFE_AGENT_FILES = Object.freeze(['config.yml', 'models.yml']);

export function isLoopbackHost(host) {
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function admitQaHost(host, tailscaleIps = []) {
  if (isLoopbackHost(host)) return { host, remote: false };
  if (tailscaleIps.includes(host)) return { host, remote: true };
  throw new Error(`Refusing non-loopback QA host ${host}; it is not a current Tailscale IPv4 address.`);
}

export function isolatedQaEnvironment({ parentEnv, qaHome, host, vitePort, serverPort, remote }) {
  const agentDir = path.join(qaHome, '.gjc', 'agent');
  const sourceHome = parentEnv.HOME || os.homedir();
  const env = {
    ...parentEnv,
    HOME: qaHome,
    USERPROFILE: qaHome,
    CARGO_HOME: parentEnv.CARGO_HOME || path.join(sourceHome, '.cargo'),
    RUSTUP_HOME: parentEnv.RUSTUP_HOME || path.join(sourceHome, '.rustup'),
    DATABASE_PATH: path.join(qaHome, '.gajae-app', 'auth.db'),
    GJC_CODING_AGENT_DIR: agentDir,
    GJC_WORKER_AGENT_DIR: agentDir,
    GJC_LIVE_SESSION_DIR: path.join(qaHome, '.gjc', 'live-sessions'),
    // Explicit values also prevent the repository's .env from restoring
    // production paths after the child process starts.
    WORKSPACES_ROOT: qaHome,
    GAJAE_BROWSER_PROFILE_DIR: path.join(qaHome, '.gajae-app', 'browser', 'profile'),
    GAJAE_BROWSER_CACHE_DIR: path.join(qaHome, '.gajae-app', 'browser', 'chromium'),
    HOST: host,
    VITE_PORT: String(vitePort),
    SERVER_PORT: String(serverPort),
  };
  delete env.GAJAE_ALLOW_UNAUTH_REMOTE;
  if (remote) env.GAJAE_ALLOW_UNAUTH_REMOTE = '1';
  return env;
}

export function safeAgentConfigPaths(sourceHome, qaHome) {
  return SAFE_AGENT_FILES.map((name) => ({
    source: path.join(sourceHome, '.gjc', 'agent', name),
    destination: path.join(qaHome, '.gjc', 'agent', name),
  }));
}

async function copySafeAgentConfig(sourceHome, qaHome) {
  await mkdir(path.join(qaHome, '.gjc', 'agent'), { recursive: true });
  for (const { source, destination } of safeAgentConfigPaths(sourceHome, qaHome)) {
    try {
      await copyFile(source, destination);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function currentTailscaleIps() {
  try {
    return execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' })
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function main() {
  const sourceHome = os.homedir();
  const qaHome = await mkdtemp(path.join(os.tmpdir(), 'gajae-app-qa-'));
  const host = process.env.GAJAE_QA_HOST?.trim() || '127.0.0.1';
  const vitePort = process.env.GAJAE_QA_VITE_PORT?.trim() || '5174';
  const serverPort = process.env.GAJAE_QA_SERVER_PORT?.trim() || '3101';

  try {
    const admission = admitQaHost(host, isLoopbackHost(host) ? [] : currentTailscaleIps());
    await copySafeAgentConfig(sourceHome, qaHome);
    const env = isolatedQaEnvironment({
      parentEnv: process.env,
      qaHome,
      host: admission.host,
      vitePort,
      serverPort,
      remote: admission.remote,
    });

    console.log(`[isolated-qa] HOME: ${qaHome}`);
    console.log(`[isolated-qa] UI: http://${host}:${vitePort}`);
    console.log(`[isolated-qa] API: http://${host}:${serverPort}`);

    const npm = npmInvocation(['run', 'dev']);
    const child = spawn(npm.command, npm.args, {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      env,
      stdio: 'inherit',
    });
    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    process.once('SIGHUP', forward);
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
    process.removeListener('SIGHUP', forward);
    process.removeListener('SIGINT', forward);
    process.removeListener('SIGTERM', forward);
    process.exitCode = exitCode;
  } finally {
    await rm(qaHome, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`[isolated-qa] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
