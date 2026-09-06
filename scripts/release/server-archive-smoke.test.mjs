import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ancestorNodeModules } from './out-of-tree.mjs';
import { smokeEnvironment, smokeLocation } from './packaged-server-paths.mjs';
import { assertServerArchiveHost, bootstrap, launch, parseSmokeOptions, serverArchiveTarget, stop, verifyAbortedReplay, workerInitializationSmoke } from './smoke-packaged-server.mjs';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-archive-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return fs.realpath(directory);
}

async function fixture(t) {
  const directory = await temporary(t);
  const root = path.join(directory, 'archive with spaces');
  const files = ['scripts/gajae-app-runtime.mjs', 'dist/index.html', 'dist-server/server/index.js', 'dist-server/server/cli.js', 'dist-server/server/gjc-bun-worker.js', 'dist-server/server/gjc-runtime-manifest.json', 'dist-native/bun', 'dist-native/gajae-core'];
  for (const relative of files) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '', { mode: 0o755 });
  }
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'gajae-app-server', version: '2.0.0-test', type: 'module' }));
  return { directory, root };
}

test('archive CLI isolates projects and rejects ambiguous layouts or combined smoke modes', () => {
  const options = parseSmokeOptions(['--server-archive-root', 'archive', '--data-survival']);
  assert.equal(options.app, path.resolve('archive'));
  assert.equal(options.linux, true, 'use the existing portable out-of-tree copy');
  assert.equal(options.serverArchive, true);
  assert.equal(options.dataSurvival, true);
  assert.equal(options.projectDir, null);
  assert.equal(parseSmokeOptions(['--server-archive-root', 'archive', '--from-copy']).fromCopy, true);
  for (const extra of [[], ['--data-survival'], ['root', '--server-archive-root', 'other'], ['root', '--tauri-app', 'app'], ['root', '--linux-root', 'deb'], ['root', '--project-dir', '/user/project'], ['root', '--appimage-env'], ['root', '--unknown'], ['root', '--data-survival', '--data-survival']]) {
    assert.throws(() => parseSmokeOptions(['--server-archive-root', ...extra]), /Usage: --server-archive-root/);
  }
  assert.equal(parseSmokeOptions(['--linux-root', 'deb']).serverArchive, undefined);
  assert.equal(parseSmokeOptions(['--tauri-app', 'app']).linux, false);
});

test('archive host gate enforces the documented platform, Node floor and glibc floor', () => {
  const baseline = { platform: 'linux', arch: 'x64', node: '22.22.2', glibc: '2.35' };
  for (const host of [baseline, { ...baseline, node: '22.23.1', glibc: '2.39' }]) assert.doesNotThrow(() => assertServerArchiveHost(host));
  for (const overrides of [{ platform: 'darwin' }, { arch: 'arm64' }, { node: '24.15.0' }, { node: '22.22.1' }, { node: '22.21.9' }, { glibc: '2.34' }, { glibc: '' }]) {
    assert.throws(() => assertServerArchiveHost({ ...baseline, ...overrides }), /Server archive smoke requires/);
  }
});

test('archive target uses host Node and the canonical start command without a desktop sidecar', async t => {
  const { root } = await fixture(t);
  const target = await serverArchiveTarget(root);
  assert.equal(target.command, process.execPath);
  assert.equal(target.cwd, root);
  assert.equal(target.serverArchive, true);
  assert.equal(target.expectedVersion, '2.0.0-test');
  assert.deepEqual(target.args, [path.join(root, 'scripts/gajae-app-runtime.mjs'), 'start']);
  assert.equal(target.bun, path.join(root, 'dist-native/bun'));
  await assert.rejects(fs.access(path.join(root, 'server')), { code: 'ENOENT' }, 'archives ship the compiled manifest, not a source server directory');
});

test('archive target rejects missing payloads, non-executable runtimes and live configuration', async t => {
  for (const [name, mutate, expected] of [
    ['missing CLI', root => fs.rm(path.join(root, 'scripts/gajae-app-runtime.mjs')), /gajae-app-runtime/],
    ['missing frontend', root => fs.rm(path.join(root, 'dist/index.html')), /index.html/],
    ['missing worker', root => fs.rm(path.join(root, 'dist-server/server/gjc-bun-worker.js')), /gjc-bun-worker/],
    ['missing manifest', root => fs.rm(path.join(root, 'dist-server/server/gjc-runtime-manifest.json')), /gjc-runtime-manifest/],
    ['missing Bun', root => fs.rm(path.join(root, 'dist-native/bun')), /bun/],
    ['non-executable core', root => fs.chmod(path.join(root, 'dist-native/gajae-core'), 0o644), /EACCES/],
    ['env credentials', root => fs.writeFile(path.join(root, '.env'), 'API_KEY=fixture'), /containing .env/],
    ['wrong metadata', root => fs.writeFile(path.join(root, 'package.json'), '{}'), /canonical/],
  ]) {
    await t.test(name, async t => {
      const { root } = await fixture(t);
      await mutate(root);
      await assert.rejects(serverArchiveTarget(root), expected);
    });
  }
});

test('archive links and dependency resolution cannot escape into the source checkout', async t => {
  const { directory, root } = await fixture(t);
  const shadow = path.join(directory, 'node_modules', 'repository-only-fixture');
  await fs.mkdir(shadow, { recursive: true });
  await fs.writeFile(path.join(shadow, 'index.js'), 'module.exports = true;');
  await assert.rejects(serverArchiveTarget(root), /module resolution would fall back/);
  await fs.mkdir(path.join(root, 'node_modules', '.bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'tool'));
  await fs.writeFile(path.join(root, 'node_modules/tool/cli.js'), '', { mode: 0o751 });
  await fs.symlink('../tool/cli.js', path.join(root, 'node_modules/.bin/tool'));
  const location = await smokeLocation(root, { linux: true });
  t.after(location.cleanup);
  const target = await serverArchiveTarget(location.app);
  assert.equal(await ancestorNodeModules(target.cwd), null);
  assert.equal(await fs.readlink(path.join(target.cwd, 'node_modules/.bin/tool')), '../tool/cli.js');
  assert.equal((await fs.stat(path.join(target.cwd, 'node_modules/.bin/tool'))).mode & 0o777, 0o751);
  const probe = "require.resolve('repository-only-fixture')";
  assert.equal(spawnSync(process.execPath, ['-e', probe], { cwd: root }).status, 0);
  const isolated = spawnSync(target.command, ['-e', probe], { cwd: target.cwd, env: smokeEnvironment(target, directory, {}), encoding: 'utf8' });
  assert.notEqual(isolated.status, 0);
  assert.match(isolated.stderr, /Cannot find module/);
  await fs.symlink(shadow, path.join(target.cwd, 'node_modules/escaped'));
  await assert.rejects(serverArchiveTarget(target.cwd), /escapes extracted root/);
  await location.cleanup();
  await fs.access(root);
});

test('worker smoke requires initialize acknowledgement and graceful shutdown, and reaps failures', { timeout: 15_000 }, async t => {
  for (const [name, behavior, expected] of [
    ['valid handshake', 'ok', null],
    ['initialization rejected', 'reject-init', /rejected initialize/],
    ['shutdown rejected', 'reject-shutdown', /rejected shutdown/],
    ['missing shutdown acknowledgement', 'omit-shutdown', /phase=shutdown/],
    ['nonzero exit after acknowledgement', 'exit-failure', /exit=7/],
    ['malformed protocol', 'malformed', /Unexpected token/],
    ['hung worker', 'hang', /timed out/],
  ]) {
    await t.test(name, async t => {
      const { root } = await fixture(t);
      const pidFile = path.join(root, 'worker.pid');
      await fs.writeFile(path.join(root, 'dist-server/server/gjc-bun-worker.js'), `
        import { createInterface } from 'node:readline';
        import { writeFileSync } from 'node:fs';
        writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
        const behavior = ${JSON.stringify(behavior)};
        const lines = createInterface({ input: process.stdin });
        lines.on('line', line => {
          const request = JSON.parse(line);
          if (behavior === 'hang') { setInterval(() => {}, 1000); return; }
          if (behavior === 'malformed') { console.log('invalid-json'); return; }
          const shutdown = request.method === 'worker.shutdown';
          if (shutdown && behavior === 'omit-shutdown') { process.exit(0); return; }
          const ok = !(shutdown ? behavior === 'reject-shutdown' : behavior === 'reject-init');
          console.log(JSON.stringify({ protocolVersion: 1, kind: 'response', id: request.id, payload: { ok } }));
          if (shutdown) process.exitCode = behavior === 'exit-failure' ? 7 : 0;
        });
      `);
      const target = { cwd: root, bun: process.execPath, command: process.execPath };
      target.env = smokeEnvironment(target, root, {});
      const check = workerInitializationSmoke(target, { timeoutMs: behavior === 'hang' ? 500 : 3000 });
      if (expected) await assert.rejects(check, expected);
      else await check;
      const pid = Number(await fs.readFile(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'worker must be reaped before returning');
    });
  }
});

test('archive launch authenticates normal server mode, serves assets and rotates only the fixture key on restart', { timeout: 15_000 }, async t => {
  const { root } = await fixture(t);
  const entry = path.join(root, 'scripts/gajae-app-runtime.mjs');
  await fs.writeFile(entry, `
    import { createServer } from 'node:http';
    import assert from 'node:assert/strict';
    assert.equal(process.argv[2], 'start');
    assert.equal(process.env.GJC_DESKTOP, undefined);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    assert.ok(process.env.DATABASE_PATH.startsWith(process.env.HOME));
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', product: 'gajae-app', protocolVersion: 1, version: '2.0.0-test' }));
      if (req.headers['x-api-key'] !== process.env.API_KEY) { res.statusCode = 401; return res.end('{}'); }
      if (req.url === '/api/auth/user') return res.end(JSON.stringify({ user: { id: 1 }, shell: { desktop: false } }));
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<script type="module" src="/assets/fixture.js"></script>'); }
      res.setHeader('content-type', 'application/javascript');
      res.end('console.log("fixture")');
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const target = await serverArchiveTarget(root);
  target.env = smokeEnvironment(target, root, { OPENAI_API_KEY: 'must-not-leak', NODE_OPTIONS: '--invalid', GJC_DESKTOP: '1' });
  const first = await launch(target, root, path.join(root, 'project'));
  t.after(() => stop(first));
  const session = await bootstrap(first);
  assert.equal(session.headers['x-api-key'], first.apiKey);
  assert.equal(session.headers.cookie, undefined);
  await stop(first);
  const second = await launch(target, root, path.join(root, 'project'));
  t.after(() => stop(second));
  await bootstrap(second);
  assert.notEqual(second.apiKey, first.apiKey);
  const stale = await fetch(`${second.baseUrl}/api/auth/user`, { headers: session.headers });
  assert.equal(stale.status, 401);
  second.expectedVersion = 'wrong-version';
  await assert.rejects(bootstrap(second), /does not match archive metadata/);
});

test('abort acceptance requires ordered durable terminal evidence for this run', () => {
  const terminal = { sequence: 2, runId: 'run-1', payload: { kind: 'job_terminal', outcome: 'aborted', jobState: 'aborted' } };
  const valid = { events: [{ sequence: 1 }, terminal] };
  assert.doesNotThrow(() => verifyAbortedReplay(valid, 'run-1'));
  for (const replay of [{}, { events: [] }, { events: [terminal] }, { events: [{ sequence: 1 }, { ...terminal, sequence: 1 }] }, { events: [{ sequence: 1 }, { ...terminal, runId: 'another-run' }] }, { events: [{ sequence: 1 }, { ...terminal, payload: { type: 'aborted' } }] }]) {
    assert.throws(() => verifyAbortedReplay(replay, 'run-1'), /not gap-free and durable/);
  }
});
