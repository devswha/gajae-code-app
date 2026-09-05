// Copied into the isolated payload by smoke-windows-server.mjs. Built-ins only:
// imports here must never pull a dependency from the repository running CI.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    try {
      await execute(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
  } else child.kill('SIGKILL');
  let timer;
  try {
    await Promise.race([closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Smoke child did not stop.')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function workerHandshake(binary, entrypoint, { env = process.env, timeout = 30_000 } = {}) {
  const worker = spawn(binary, [entrypoint], { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let timer;
  let buffered = '';
  let stderr = '';
  let initialized = false;
  let shutdown = false;
  try {
    await new Promise((resolve, reject) => {
      const send = (id, method) => worker.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'request', id, method, payload: {} }) + '\n');
      timer = setTimeout(() => reject(new Error(`Bun worker timed out: ${stderr}${buffered}`)), timeout);
      worker.once('error', reject);
      worker.stdin.once('error', reject);
      worker.stdout.setEncoding('utf8');
      worker.stderr.setEncoding('utf8');
      worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32_768); });
      worker.stdout.on('data', chunk => {
        buffered += chunk;
        if (buffered.length > 1_048_576) { reject(new Error('Bun worker frame too large.')); return; }
        const lines = buffered.split('\n');
        buffered = lines.pop();
        try {
          for (const line of lines) {
            if (!line.trim()) continue;
            const frame = JSON.parse(line);
            assert.equal(frame.protocolVersion, 1, 'Bun worker protocol mismatch');
            if (frame.kind === 'event') continue;
            assert.equal(frame.kind, 'response', 'Bun worker response kind mismatch');
            assert.equal(frame.payload?.ok, true, `Bun worker rejected ${frame.method}: ${JSON.stringify(frame.payload)}`);
            if (frame.id === 'init' && frame.method === 'worker.initialize' && !initialized) {
              initialized = true;
              send('shutdown', 'worker.shutdown');
              worker.stdin.end();
            } else if (frame.id === 'shutdown' && frame.method === 'worker.shutdown' && initialized) shutdown = true;
            else throw new Error('Unexpected Bun worker response.');
          }
        } catch (error) { reject(error); }
      });
      worker.once('close', code => {
        if (code === 0 && initialized && shutdown && !buffered.trim()) resolve();
        else reject(new Error(`Bun worker handshake failed (exit ${code}, init=${initialized}, shutdown=${shutdown}): ${stderr}${buffered}`));
      });
      worker.once('spawn', () => send('init', 'worker.initialize'));
    });
  } catch (error) {
    throw new Error(`${error.message}${stderr.trim() ? `\nWorker diagnostics:\n${stderr}` : ''}`, { cause: error });
  } finally {
    clearTimeout(timer);
    await stopProcessTree(worker);
  }
}

export async function stopServerGracefully(child, { timeoutMs = 20_000, forceStop = stopProcessTree } = {}) {
  if (!child.pid) return;
  let timer;
  try {
    const closed = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      : new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    const requestAndExit = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve, reject) => {
          child.stdin.write('gajae-desktop-shutdown\n', error => error ? reject(error) : resolve());
        });
      }
      return closed;
    };
    const result = await Promise.race([requestAndExit(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Desktop server graceful shutdown timed out.')), timeoutMs);
    })]);
    assert.equal(result.code, 0, `Desktop server shutdown failed (exit ${result.code}, signal ${result.signal}).`);
  } finally {
    clearTimeout(timer);
    // A timed-out or broken stdin shutdown must not leave the server or its
    // worker guard alive. The outer Job also owns detached descendants.
    await forceStop(child);
  }
}

export function assertRuntimeCatalog(catalog) {
  assert.equal(catalog.success, true, 'Provider model catalog request failed');
  assert.equal(catalog.data?.provider, 'gjc');
  assert.ok(Array.isArray(catalog.data?.models?.OPTIONS), 'Provider model presets are missing');
  // The route returns preset-only HTTP 200 even when supervisor initialization
  // fails. MODELS is present (possibly empty with no credentials) only when
  // the runtime catalog loader actually returned through the supervisor.
  assert.ok(Object.hasOwn(catalog.data.models, 'MODELS') && Array.isArray(catalog.data.models.MODELS),
    'Supervised GJC runtime catalog is unavailable; preset-only fallback cannot pass smoke');
  assert.equal(catalog.data.cache?.source, 'fresh', 'Catalog smoke must bypass disk and memory caches');
}

async function terminalSmoke(require) {
  const pty = require('node-pty');
  await new Promise((resolve, reject) => {
    const terminal = pty.spawn(process.execPath, ['-e', 'process.stdout.write("GAJAE_PTY_OK"); process.exitCode = 0'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
    });
    let output = '';
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error(`ConPTY smoke timed out: ${output}`));
    }, 15_000);
    terminal.onData(chunk => { output += chunk; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0 && output.includes('GAJAE_PTY_OK')) resolve();
      else reject(new Error(`ConPTY smoke failed (${exitCode}): ${output}`));
    });
  });
}

async function freePort() {
  const socket = net.createServer();
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

export async function serverSmoke(payloadDir, expectedVersion, { env = process.env, shutdownTimeoutMs = 20_000 } = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const nonce = randomUUID();
  const bootstrapSource = await fs.readFile(path.join(payloadDir, '.gajae-windows-server-bootstrap.cjs'), 'utf8');
  const server = spawn(process.execPath, ['--eval', bootstrapSource, path.join(payloadDir, 'dist-server', 'server', 'index.js')], {
    cwd: payloadDir,
    env: { ...env, SERVER_PORT: String(port), GJC_DESKTOP: '1', GJC_DESKTOP_API_KEY: randomUUID(), GJC_DESKTOP_BOOTSTRAP_NONCE: nonce },
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError;
  let ready;
  let buffered = '';
  server.once('error', error => { spawnError = error; });
  server.stdin.on('error', error => { spawnError = error; });
  server.stdout.setEncoding('utf8');
  server.stderr.setEncoding('utf8');
  server.stdout.on('data', chunk => {
    output = (output + chunk).slice(-32_768);
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      try {
        const frame = JSON.parse(line);
        if (frame.kind === 'gajae-desktop-ready') ready = frame;
      } catch { /* Other stdout lines are ordinary server diagnostics. */ }
    }
  });
  server.stderr.on('data', chunk => { output = (output + chunk).slice(-32_768); });
  const request = (route, options = {}) => fetch(base + route, {
    ...options, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(2_000),
    headers: { connection: 'close', ...options.headers },
  });
  try {
    let health;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Server exited before health: ${output}`);
      try {
        const response = await request('/health');
        if (response.ok) health = await response.json();
      } catch { /* The server has not bound its loopback socket yet. */ }
      if (health && ready) break;
      await delay(100);
    }
    assert.ok(health && ready, `Server did not become ready: ${output}`);
    assert.equal(ready.pid, server.pid);
    assert.equal(ready.host, '127.0.0.1');
    assert.equal(ready.port, port);
    assert.equal(ready.protocolVersion, 1);
    assert.equal(ready.version, expectedVersion);
    assert.equal(health.status, 'ok');
    assert.equal(health.product, 'gajae-app');
    assert.equal(health.protocolVersion, 1);
    assert.equal(health.version, expectedVersion);
    const unauthorized = await request('/api/projects');
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    const bootstrap = await request(`/desktop/bootstrap?nonce=${encodeURIComponent(nonce)}`);
    assert.equal(bootstrap.status, 303);
    assert.equal(bootstrap.headers.get('location'), '/');
    const cookie = bootstrap.headers.get('set-cookie');
    assert.ok(cookie?.includes('HttpOnly') && cookie.includes('gajae_desktop_api_key='));
    await bootstrap.arrayBuffer();
    const headers = { cookie: cookie.split(';', 1)[0], origin: base };
    const page = await request('/', { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html[\s>]/i);
    const projects = await request('/api/projects', { headers });
    assert.equal(projects.status, 200);
    await projects.json();
    const models = await request('/api/providers/gjc/models?bypassCache=true', {
      headers, signal: AbortSignal.timeout(45_000),
    });
    assert.equal(models.status, 200, `Supervised model catalog failed: ${output}`);
    assertRuntimeCatalog(await models.json());
    const replay = await request(`/desktop/bootstrap?nonce=${encodeURIComponent(nonce)}`);
    assert.equal(replay.status, 401);
    await replay.arrayBuffer();
    assert.ok((await fs.stat(env.DATABASE_PATH)).isFile(), 'Smoke database was not created in the isolated profile');
  } catch (error) {
    throw new Error(`${error.message}\nServer diagnostics:\n${output}`, { cause: error });
  } finally {
    await stopServerGracefully(server, { timeoutMs: shutdownTimeoutMs }).catch(error => {
      throw new Error(`${error.message}\nServer diagnostics:\n${output}`, { cause: error });
    });
  }
}

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  const [expectedNode, expectedBun] = process.argv.slice(2);
  assert.equal(process.version, `v${expectedNode}`);
  assert.equal(path.basename(process.execPath), 'gajae-app-server.exe');
  assert.equal(os.homedir().toLowerCase(), process.env.USERPROFILE.toLowerCase());
  const payloadDir = process.cwd();
  const require = createRequire(path.join(payloadDir, 'package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try { assert.equal(db.prepare('SELECT 22 AS value').get().value, 22); }
  finally { db.close(); }
  await terminalSmoke(require);
  const bun = path.join(payloadDir, 'dist-native', 'bun.exe');
  const core = path.join(payloadDir, 'dist-native', 'gajae-core.exe');
  const capture = async (command, args) => (await execute(command, args, { windowsHide: true, timeout: 15_000 })).stdout.trim();
  assert.equal(await capture(bun, ['--version']), expectedBun);
  assert.match(await capture(core, ['--version']), /^gajae-core \d+\.\d+\.\d+$/);
  assert.equal(await capture(core, ['--', process.execPath, '--version']), `v${expectedNode}`);
  const { rgPath } = require('@vscode/ripgrep');
  assert.match(await capture(rgPath, ['--version']), /^ripgrep /);
  await workerHandshake(bun, path.join(payloadDir, 'dist-server', 'server', 'gjc-bun-worker.js'));
  const { version } = JSON.parse(await fs.readFile(path.join(payloadDir, 'package.json'), 'utf8'));
  await serverSmoke(payloadDir, version);
  console.log('Windows payload smoke passed: Node, SQLite, ConPTY, core, ripgrep, Bun worker, supervised model catalog/Job chain, desktop bootstrap/auth, frontend and graceful shutdown.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
