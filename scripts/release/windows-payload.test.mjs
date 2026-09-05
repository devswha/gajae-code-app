import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildWindowsServerPayload } from './build-windows-server-payload.mjs';
import { removeExcludedDistributionPackages } from './distribution-exclusions.mjs';
import { runGuardedSmoke } from './smoke-windows-server.mjs';
import {
  assertWindowsHost, assertWindowsX64Executable, pruneNonRuntimeMetadata,
  restrictRuntimeDependencies, verifyManifest, windowsBuildEnvironment, windowsSmokeEnvironment,
} from './windows-payload.mjs';
import { assertRuntimeCatalog, serverSmoke, stopProcessTree, stopServerGracefully, workerHandshake } from './windows-server-smoke-checks.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'windows payload 가재-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function pe(machine = 0x8664) {
  const buffer = Buffer.alloc(134);
  buffer.write('MZ');
  buffer.writeUInt32LE(128, 60);
  buffer.writeUInt32LE(0x00004550, 128);
  buffer.writeUInt16LE(machine, 132);
  return buffer;
}

test('Windows builder rejects other hosts before touching payload outputs', async () => {
  assert.doesNotThrow(() => assertWindowsHost('win32', 'x64'));
  for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'arm64'], ['win32', 'ia32']]) {
    assert.throws(() => assertWindowsHost(platform, arch), /requires win32-x64/);
  }
  if (process.platform !== 'win32') await assert.rejects(buildWindowsServerPayload(), /requires win32-x64/);
});

test('runtime package restriction retains only the macOS runtime closure at locked versions', async t => {
  const root = await fixture(t);
  // Use the repository lock as the integration fixture: this catches omitted
  // transitive imports such as shell-quote as well as upstream dependency drift.
  const lock = JSON.parse(await fs.readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const source = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  source.optionalDependencies = { 'not-a-runtime': '1.0.0' };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(source));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  await restrictRuntimeDependencies(root);
  const result = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(result.dependencies['@gajae-code/coding-agent'], lock.packages['node_modules/@gajae-code/coding-agent'].version);
  assert.equal(result.dependencies['shell-quote'], lock.packages['node_modules/shell-quote'].version);
  for (const excluded of ['react', 'vite', 'typescript', '@tauri-apps/cli']) assert.equal(result.dependencies[excluded], undefined);
  assert.equal(result.devDependencies, undefined);
  assert.equal(result.optionalDependencies, undefined);
  assert.deepEqual(result.scripts, {});
  for (const [name, version] of Object.entries(result.dependencies)) assert.equal(version, lock.packages[`node_modules/${name}`].version);
  delete lock.packages['node_modules/shell-quote'];
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  await assert.rejects(restrictRuntimeDependencies(root), /shell-quote/);
});

test('PE verification rejects Linux, ARM64 and truncated inputs before process launch', async t => {
  const root = await fixture(t);
  const binary = path.join(root, 'runtime.exe');
  await fs.writeFile(binary, pe());
  await assertWindowsX64Executable(binary);
  for (const invalid of [Buffer.from('\u007fELF'), pe(0xaa64), pe().subarray(0, 130)]) {
    await fs.writeFile(binary, invalid);
    await assert.rejects(assertWindowsX64Executable(binary), /Expected a Windows x64 executable/);
  }
});

test('smoke environment discards developer identity, runtime overrides and global module paths', () => {
  const env = windowsSmokeEnvironment(String.raw`C:\runtime space 가재`, String.raw`C:\isolated user 가재`, {
    SystemRoot: String.raw`C:\Windows`, Path: 'C:\\global-node', PATH: 'C:\\another-node',
    HOME: 'C:\\real-user', USERPROFILE: 'C:\\real-user', APPDATA: 'C:\\real-appdata',
    NODE_PATH: 'C:\\repo\\node_modules', NODE_OPTIONS: '--require C:\\injection.cjs',
    GJC_RUNTIME_MANIFEST_PATH: 'C:\\wrong.json', GJC_ALLOW_RUNTIME_MANIFEST_OVERRIDE: '1',
    DATABASE_PATH: 'C:\\real.db', GJC_BUN_PATH: 'C:\\global\\bun.exe', ANTHROPIC_API_KEY: 'must-not-inherit',
  });
  assert.equal(env.Path, undefined);
  assert.equal(env.NODE_PATH, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GJC_ALLOW_RUNTIME_MANIFEST_OVERRIDE, undefined);
  assert.equal(env.GJC_BUN_PATH, undefined);
  assert.equal(env.HOME, env.USERPROFILE);
  assert.ok(env.PATH.startsWith('C:\\runtime space 가재;'));
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'DATABASE_PATH', 'WORKSPACES_ROOT', 'TEMP', 'GJC_WORKER_AGENT_DIR']) {
    assert.ok(env[key].startsWith(env.USERPROFILE), `${key} must be isolated`);
  }
  const build = windowsBuildEnvironment('C:\\pinned node', { Path: 'C:\\toolchain', NODE_OPTIONS: '--require bad', NODE_PATH: 'bad' });
  assert.equal(build.PATH, 'C:\\pinned node;C:\\toolchain');
  assert.equal(build.Path, undefined);
  assert.equal(build.NODE_OPTIONS, undefined);
});

async function manifestFixture(root) {
  const binary = pe();
  const manifest = { schemaVersion: 1, bun: '1.4.0', gjcSdk: '0.15.6', natives: '0.15.6', platforms: {
    'win32-x64': { files: [{ package: '@gajae-code/natives-win32-x64', path: 'native/addon.node', sha256: createHash('sha256').update(binary).digest('hex') }] },
  } };
  for (const name of ['@gajae-code/coding-agent', '@gajae-code/natives', '@gajae-code/natives-win32-x64']) {
    const packageDir = path.join(root, 'node_modules', name);
    await fs.mkdir(path.join(packageDir, 'native'), { recursive: true });
    await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: '0.15.6' }));
  }
  await fs.writeFile(path.join(root, 'node_modules/@gajae-code/natives-win32-x64/native/addon.node'), binary);
  const write = async () => {
    for (const dir of ['server', 'dist-server/server']) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
      await fs.writeFile(path.join(root, dir, 'gjc-runtime-manifest.json'), JSON.stringify(manifest));
    }
  };
  await write();
  return { manifest, write };
}

test('manifest verification detects absent Windows closure, stale compiled manifests and tampered binaries', async t => {
  const root = await fixture(t);
  const { manifest, write } = await manifestFixture(root);
  await verifyManifest(root);
  await fs.writeFile(path.join(root, 'dist-server/server/gjc-runtime-manifest.json'), '{}');
  await assert.rejects(verifyManifest(root), /Compiled runtime manifest is stale/);
  await write();
  const file = manifest.platforms['win32-x64'].files[0];
  const original = file.sha256;
  file.sha256 = '0'.repeat(64);
  await write();
  await assert.rejects(verifyManifest(root), /Manifest hash mismatch/);
  file.sha256 = original;
  file.path = 'native/../../escape.node';
  await write();
  await assert.rejects(verifyManifest(root), /Invalid native manifest entry/);
  manifest.platforms = {};
  await write();
  await assert.rejects(verifyManifest(root), /win32-x64 native closure/);
});

test('production pruning keeps runtime TypeScript, DLLs, Unicode names and distribution stubs', async t => {
  const root = await fixture(t);
  const modules = path.join(root, 'node_modules');
  for (const name of ['elkjs', 'mupdf', 'example']) {
    await fs.mkdir(path.join(modules, name), { recursive: true });
    await fs.writeFile(path.join(modules, name, 'package.json'), JSON.stringify({ name, version: '1.2.3' }));
  }
  for (const name of ['runtime.ts', 'types.d.ts', 'module.d.mts', 'module.js.map', 'conpty.dll', '가재.js']) {
    await fs.writeFile(path.join(modules, 'example', name), 'fixture');
  }
  const exclusions = await removeExcludedDistributionPackages(fs, path, modules);
  assert.ok(exclusions.stubbed.includes('elkjs'));
  await assert.rejects(fs.access(path.join(modules, 'mupdf')), { code: 'ENOENT' });
  const stub = JSON.parse(await fs.readFile(path.join(modules, 'elkjs', 'package.json'), 'utf8'));
  assert.equal(stub.license, 'MIT');
  assert.equal(stub.version, '1.2.3');
  assert.equal(await pruneNonRuntimeMetadata(modules), 3);
  assert.deepEqual((await fs.readdir(path.join(modules, 'example'))).sort(), ['conpty.dll', 'package.json', 'runtime.ts', '가재.js'].sort());
});

test('Bun worker smoke handles chunked protocol output and demands acknowledged shutdown', async t => {
  const root = await fixture(t);
  const worker = path.join(root, 'fake worker 가재.mjs');
  await fs.writeFile(worker, `
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => {
      const request = JSON.parse(line);
      const response = JSON.stringify({ ...request, kind: 'response', payload: { ok: true } }) + '\\n';
      process.stdout.write(response.slice(0, 7));
      process.stdout.write(response.slice(7));
      if (request.method === 'worker.shutdown') lines.close();
    });
  `);
  await workerHandshake(process.execPath, worker, { timeout: 5_000 });
  await fs.writeFile(worker, 'process.exit(0);');
  await assert.rejects(workerHandshake(process.execPath, worker, { timeout: 5_000 }), /handshake failed/);
  await fs.writeFile(worker, 'process.stdout.write("not JSON\\n"); setInterval(() => {}, 1000);');
  await assert.rejects(workerHandshake(process.execPath, worker, { timeout: 5_000 }), /JSON/);
  await fs.writeFile(worker, 'setInterval(() => {}, 1000);');
  await assert.rejects(workerHandshake(process.execPath, worker, { timeout: 100 }), /timed out/);
});

test('successful worker initialization and shutdown tolerate SDK stderr diagnostics', async t => {
  const root = await fixture(t);
  const worker = path.join(root, 'diagnostic worker.mjs');
  await fs.writeFile(worker, `
    import readline from 'node:readline';
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => {
      const request = JSON.parse(line);
      process.stderr.write('SDK diagnostic: no credentials configured\\n');
      process.stdout.write(JSON.stringify({ ...request, kind: 'response', payload: { ok: true } }) + '\\n');
      if (request.method === 'worker.shutdown') lines.close();
    });
  `);
  await workerHandshake(process.execPath, worker, { timeout: 5_000 });
  await fs.writeFile(worker, 'process.stderr.write("SDK diagnostic before failure\\n"); process.exit(1);');
  await assert.rejects(workerHandshake(process.execPath, worker, { timeout: 5_000 }), /SDK diagnostic before failure/);
});

test('catalog smoke accepts empty runtime availability but rejects preset-only and cached responses', () => {
  const catalog = { success: true, data: { provider: 'gjc', models: { OPTIONS: [], MODELS: [] }, cache: { source: 'fresh' } } };
  assert.doesNotThrow(() => assertRuntimeCatalog(catalog));
  delete catalog.data.models.MODELS;
  assert.throws(() => assertRuntimeCatalog(catalog), /preset-only fallback/);
  catalog.data.models = Object.assign(Object.create({ MODELS: [] }), { OPTIONS: [] });
  assert.throws(() => assertRuntimeCatalog(catalog), /preset-only fallback/);
  catalog.data.models.MODELS = [];
  catalog.data.cache.source = 'disk';
  assert.throws(() => assertRuntimeCatalog(catalog), /bypass disk and memory caches/);
});

test('server smoke uses the production bootstrap, authenticated catalog and graceful stdin shutdown', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'dist-server', 'server'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await fs.copyFile(new URL('../../src-tauri/src/windows-server-bootstrap.cjs', import.meta.url), path.join(root, '.gajae-windows-server-bootstrap.cjs'));
  await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify({ OPTIONS: [], MODELS: [] }));
  await fs.writeFile(path.join(root, 'dist-server', 'server', 'index.js'), `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    assert.equal(process.execArgv[0], '--eval');
    assert.equal(os.homedir(), process.env.HOME);
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    const port = Number(process.env.SERVER_PORT);
    let used = false;
    let catalogRequested = false;
    const app = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1:' + port);
      const json = (body, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
      if (url.pathname === '/health') return json({ status: 'ok', product: 'gajae-app', protocolVersion: 1, version: 'smoke-version' });
      if (url.pathname === '/desktop/bootstrap') {
        if (used || url.searchParams.get('nonce') !== process.env.GJC_DESKTOP_BOOTSTRAP_NONCE) return json({}, 401);
        used = true;
        response.writeHead(303, { location: '/', 'set-cookie': 'gajae_desktop_api_key=' + process.env.GJC_DESKTOP_API_KEY + '; HttpOnly' });
        response.end(); return;
      }
      if (request.headers.cookie !== 'gajae_desktop_api_key=' + process.env.GJC_DESKTOP_API_KEY) return json({}, 401);
      if (url.pathname === '/') { response.end('<html><body>fixture</body></html>'); return; }
      if (url.pathname === '/api/projects') return json([]);
      if (url.pathname === '/api/providers/gjc/models' && url.searchParams.get('bypassCache') === 'true') {
        assert.equal(request.method, 'GET');
        assert.equal(request.headers.origin, 'http://127.0.0.1:' + port);
        catalogRequested = true;
        // A real cold SDK takes longer than the health request's two seconds.
        // This catches regressions that overwrite the catalog-specific signal.
        setTimeout(() => json({ success: true, data: { provider: 'gjc', models: JSON.parse(fs.readFileSync('catalog.json', 'utf8')), cache: { source: 'fresh' } } }), 2100);
        return;
      }
      json({}, 404);
    });
    process.on('SIGTERM', () => {
      fs.writeFileSync(path.join(process.env.HOME, 'shutdown.json'), JSON.stringify({ catalogRequested }));
      app.close(() => process.exit(0));
      app.closeAllConnections();
    });
    fs.writeFileSync(process.env.DATABASE_PATH, 'isolated fixture database');
    app.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ kind: 'gajae-desktop-ready', pid: process.pid, host: '127.0.0.1', port, protocolVersion: 1, version: 'smoke-version' })));
  `);
  const env = windowsSmokeEnvironment(path.dirname(process.execPath), root);
  await serverSmoke(root, 'smoke-version', { env, shutdownTimeoutMs: 5_000 });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'shutdown.json'), 'utf8')), { catalogRequested: true });
  await fs.rm(path.join(root, 'shutdown.json'));
  await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify({ OPTIONS: [] }));
  await assert.rejects(serverSmoke(root, 'smoke-version', { env, shutdownTimeoutMs: 5_000 }), /preset-only fallback/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'shutdown.json'), 'utf8')), { catalogRequested: true });
});

test('unresponsive stdin shutdown fails within its bound and forcibly reaps the server', async t => {
  const root = await fixture(t);
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume(); console.log("ready"); setInterval(() => {}, 1000);'], {
    env: windowsSmokeEnvironment(path.dirname(process.execPath), root), stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => stopProcessTree(child));
  child.stdin.on('error', () => {});
  await once(child.stdout, 'data');
  await assert.rejects(stopServerGracefully(child, { timeoutMs: 100 }), /graceful shutdown timed out/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('outer smoke reaps its named Job after success, failure, invalid prelude and timeout', async t => {
  const root = await fixture(t);
  const guard = path.join(root, 'fake guard.mjs');
  await fs.writeFile(guard, `
    import readline from 'node:readline';
    const mode = process.argv[2];
    console.log(mode === 'invalid' ? 'bad prelude' : 'fixture-ready');
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => {
      if (line !== 'fixture-ack') process.exit(3);
      if (mode !== 'timeout') process.stdout.write('checks ran\\n', () => process.exit(mode === 'failure' ? 7 : 0));
    });
  `);
  for (const mode of ['success', 'failure', 'invalid', 'timeout']) {
    const reaped = [];
    let output = '';
    const jobRuntime = {
      GJC_WINDOWS_JOB_GUARD_READY: 'fixture-ready', GJC_WINDOWS_JOB_GUARD_ACK: 'fixture-ack',
      createWindowsJobLaunch: (_node, _args, env) => ({ command: process.execPath, args: [guard, mode], env, jobName: 'fixture-job' }),
      killWindowsJobGuard: async (child, launch) => {
        reaped.push({ exitCode: child.exitCode, jobName: launch.jobName });
        await stopProcessTree(child);
      },
    };
    const running = runGuardedSmoke({ nodePath: process.execPath, args: [], cwd: root,
      env: windowsSmokeEnvironment(path.dirname(process.execPath), root), jobRuntime,
      timeoutMs: mode === 'timeout' ? 100 : 5_000, stdout: { write: chunk => { output += chunk.toString(); } },
    });
    if (mode === 'success') {
      await running;
      assert.match(output, /checks ran/);
      assert.equal(reaped[0].exitCode, 0);
    } else await assert.rejects(running, /failed|ownership|timed out/);
    assert.equal(reaped.length, 1);
    assert.equal(reaped[0].jobName, 'fixture-job');
  }
});
