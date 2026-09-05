#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import path from 'node:path';

import { createSmokeDataDirectory, packagedTargets, parseSmokeOptions, smokeEnvironment, smokeLocation } from './packaged-server-paths.mjs';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function request(url, { headers, method = 'GET', body, redirect = 'manual' } = {}) {
  // Force a fresh connection per request: the packaged server may close
  // keep-alive after a response, and undici socket reuse would then fail
  // with UND_ERR_SOCKET ("other side closed") on the next request.
  return fetch(url, { headers: { ...headers, connection: 'close' }, method, body, redirect });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => error ? reject(error) : resolve(port));
    });
    server.listen(0, '127.0.0.1');
  });
}

async function waitForHealth(baseUrl, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await request(`${baseUrl}/health`);
      const health = await response.json();
      if (response.ok && health.status === 'ok' && health.product === 'gajae-app' && health.protocolVersion === 1 && typeof health.version === 'string' && health.version) return health;
    } catch {
      // The sidecar has not bound its loopback port yet.
    }
    await delay(100);
  }
  throw new Error(`Packaged server did not become healthy:\n${output.value}`);
}

async function prepareSmoke(target, dataDirectory, suppliedProjectDir) {
  const env = smokeEnvironment(target, dataDirectory);
  for (const directory of [path.join(dataDirectory, 'bin'), env.TMPDIR, env.GJC_WORKER_AGENT_DIR]) await mkdir(directory, { recursive: true });
  // Scripts invoking `node` through PATH must use the shipped sidecar too.
  await symlink(target.command, path.join(dataDirectory, 'bin', 'node'));
  const projectDir = suppliedProjectDir || path.join(dataDirectory, 'project');
  if (!suppliedProjectDir) {
    await mkdir(projectDir);
    for (const args of [
      ['init', '--quiet', '--initial-branch=main'],
      ['-c', 'user.name=Packaged Smoke', '-c', 'user.email=packaged-smoke@localhost', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Packaged smoke fixture'],
    ]) {
      await new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`Packaged smoke project setup failed (${code}): ${stderr}`)));
      });
    }
  }
  return { target: { ...target, env }, projectDir };
}

function launch(target, dataDirectory, projectDir) {
  const portPromise = freePort();
  return portPromise.then(port => {
    const baseUrl = `http://127.0.0.1:${port}`;
    const apiKey = `smoke-key-${crypto.randomUUID()}`;
    const nonce = `smoke-nonce-${crypto.randomUUID()}`;
    const output = { value: '' };
    const child = spawn(target.command, target.args, {
      cwd: target.cwd,
      env: {
        ...target.env,
        DATABASE_PATH: path.join(dataDirectory, 'auth.db'),
        GJC_WORKER_AGENT_DIR: path.join(dataDirectory, 'agent'),
        GJC_DESKTOP: '1', GJC_DESKTOP_API_KEY: apiKey, GJC_DESKTOP_BOOTSTRAP_NONCE: nonce,
        HOME: dataDirectory, WORKSPACES_ROOT: projectDir, HOST: '127.0.0.1', NODE_ENV: 'production', SERVER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output.value += chunk; });
    child.stderr.on('data', chunk => { output.value += chunk; });
    child.once('error', error => { output.value += `\n${error.message}`; });
    return { child, baseUrl, nonce, output };
  });
}

async function nativeClosureSmoke(target) {
  const source = `
    import { createRequire } from 'node:module';
    import { createHash } from 'node:crypto';
    import { spawnSync } from 'node:child_process';
    import { readFileSync } from 'node:fs';
    import path from 'node:path';
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const pty = require('node-pty');
    const lightningcss = require('lightningcss');
    const database = new Database(':memory:');
    if (database.prepare('SELECT 1 AS value').get().value !== 1) throw new Error('better-sqlite3 native smoke failed');
    database.close();
    lightningcss.transform({ filename: 'smoke.css', code: Buffer.from('a { color: red; }') });
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'server/gjc-runtime-manifest.json'), 'utf8'));
    const platform = process.platform + '-' + process.arch;
    const closure = manifest.platforms[platform]?.files ?? [];
    if (!closure.length) throw new Error('Gajae native manifest is missing for ' + platform);
    for (const entry of closure) {
      const filename = path.join(process.cwd(), 'node_modules', entry.package, entry.path);
      if (createHash('sha256').update(readFileSync(filename)).digest('hex') !== entry.sha256) {
        throw new Error('Packaged native hash mismatch: ' + entry.package + '/' + entry.path);
      }
    }
    const natives = manifest.platforms[platform]?.files.filter(entry => entry.path.endsWith('.node')) ?? [];
    const nativeEntry = natives.find(entry => entry.path.includes('-baseline.node')) ?? natives[0];
    if (!nativeEntry) throw new Error('Gajae native manifest entry is missing for ' + platform);
    const nativeBindings = require(path.join(process.cwd(), 'node_modules', nativeEntry.package, nativeEntry.path));
    const sentinel = '__piNativesV' + manifest.natives.replace(/[^A-Za-z0-9]/g, '_');
    if (typeof nativeBindings[sentinel] !== 'function') throw new Error('Gajae native version sentinel is missing');
    const bun = spawnSync(path.join(process.cwd(), 'dist-native', 'bun'), ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (bun.error || bun.status !== 0 || bun.stdout.trim() !== manifest.bun) throw new Error('Bundled Bun version mismatch: ' + (bun.error?.message ?? bun.stderr ?? bun.stdout));
    await new Promise((resolve, reject) => {
      const terminal = pty.spawn(process.execPath, ['-e', 'process.exit(0)'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
      const timer = setTimeout(() => { terminal.kill(); reject(new Error('node-pty native smoke timed out')); }, 5000);
      terminal.onExit(({ exitCode }) => { clearTimeout(timer); exitCode === 0 ? resolve() : reject(new Error('node-pty native smoke exited ' + exitCode)); });
    });
  `;
  await new Promise((resolve, reject) => {
    const child = spawn(target.command, ['--input-type=module', '--eval', source], {
      cwd: target.cwd,
      env: target.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve()
      : reject(new Error(`Packaged native closure smoke failed (${code}): ${stderr || stdout}`)));
  });
}

async function bootstrap(instance) {
  const health = await waitForHealth(instance.baseUrl, instance.output);
  const bootstrap = await request(`${instance.baseUrl}/desktop/bootstrap?nonce=${encodeURIComponent(instance.nonce)}`);
  const cookie = bootstrap.headers.get('set-cookie');
  if (bootstrap.status !== 303 || bootstrap.headers.get('location') !== '/' || !cookie?.includes('HttpOnly') || !cookie.includes('gajae_desktop_api_key=')) throw new Error('Desktop bootstrap did not produce the required HttpOnly cookie and root redirect.');
  const replay = await request(`${instance.baseUrl}/desktop/bootstrap?nonce=${encodeURIComponent(instance.nonce)}`);
  if (replay.status !== 401) throw new Error(`Bootstrap nonce replay status was ${replay.status}, expected 401.`);
  return { health, headers: { cookie: cookie.split(';', 1)[0], origin: instance.baseUrl } };
}

async function stop(instance) {
  if (!instance.child.pid) return;
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) return;
  const closed = new Promise(resolve => instance.child.once('close', resolve));
  instance.child.kill('SIGTERM');
  await Promise.race([closed, delay(15_000).then(() => { throw new Error(`Packaged server did not exit after SIGTERM:\n${instance.output.value}`); })]);
}

async function json(response, context) {
  const value = await response.json();
  if (!response.ok) throw new Error(`${context} failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

async function sqliteSnapshot(target, database) {
  if (!existsSync(database)) throw new Error(`Expected durable SQLite database is missing: ${database}`);
  const source = `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const Database = require('better-sqlite3'); const db = new Database(process.argv[1], { readonly: true }); const schema = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all(); const userVersion = db.pragma('user_version', { simple: true }); console.log(JSON.stringify({ userVersion, schema })); db.close();`;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(target.command, ['--input-type=module', '--eval', source, database], {
      cwd: target.cwd, env: target.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`SQLite schema inspection failed (${code}): ${stderr}`)));
  });
  return JSON.parse(output.trim());
}
async function createV6JobsFixture(target, database) {
  const source = `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const Database = require('better-sqlite3'); const db = new Database(process.argv[1]); db.pragma('foreign_keys = ON'); db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO schema_migrations(version) VALUES(5),(6); CREATE TABLE jobs (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, state TEXT NOT NULL, lease_owner TEXT NULL, lease_generation INTEGER NOT NULL DEFAULT 0, next_lease_generation INTEGER NOT NULL DEFAULT 1, worktree_id TEXT NULL, branch TEXT NULL, base_commit TEXT NULL, repository_root TEXT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, prompt TEXT NULL); CREATE TABLE runs (run_id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, app_session_id TEXT NULL, provider_session_id TEXT NULL, state TEXT NOT NULL DEFAULT 'queued', outcome TEXT NULL, dispatched_at TEXT NULL); CREATE TABLE job_events (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, run_id TEXT NULL REFERENCES runs(run_id), UNIQUE(job_id,sequence), UNIQUE(job_id,event_id)); CREATE INDEX job_events_job_sequence ON job_events(job_id,sequence); CREATE TABLE session_job_bindings (provider TEXT NOT NULL, app_session_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), provider_session_id TEXT NULL, bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, released_at TEXT NULL, UNIQUE(job_id)); CREATE UNIQUE INDEX active_session_job_bindings ON session_job_bindings(provider,app_session_id) WHERE released_at IS NULL;"); db.prepare("INSERT INTO jobs(id,provider,state,lease_owner,lease_generation,next_lease_generation,created_at,prompt) VALUES(?, 'gjc', 'succeeded', NULL, 0, 1, '2026-01-01T00:00:00.000Z', 'preserved packaged v6 job')").run(process.argv[2]); db.prepare("INSERT INTO runs(run_id,job_id,app_session_id,state,outcome,dispatched_at) VALUES('packaged-v6-run', ?, 'packaged-v6-session', 'succeeded', 'succeeded', '2026-01-01T00:00:01.000Z')").run(process.argv[2]); db.prepare("INSERT INTO job_events(job_id,sequence,event_id,payload,run_id) VALUES(?, 1, 'packaged-v6-event', '{\\"type\\":\\"completed\\"}', 'packaged-v6-run')").run(process.argv[2]); db.close();`;
  await new Promise((resolve, reject) => {
    const child = spawn(target.command, ['--input-type=module', '--eval', source, database, 'packaged-v6-preserved-job'], {
      cwd: target.cwd, env: target.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`v6 jobs fixture creation failed (${code}): ${stderr}`)));
  });
}

async function v7MigrationSnapshot(target, database) {
  const source = `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const Database = require('better-sqlite3'); const db = new Database(process.argv[1], { readonly: true }); const migrationVersion = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version; const archivedAt = db.prepare('SELECT archived_at AS archivedAt FROM jobs WHERE id=?').get(process.argv[2])?.archivedAt; console.log(JSON.stringify({ migrationVersion, archivedAt })); db.close();`;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(target.command, ['--input-type=module', '--eval', source, database, 'packaged-v6-preserved-job'], {
      cwd: target.cwd, env: target.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`v7 migration inspection failed (${code}): ${stderr}`)));
  });
  return JSON.parse(output.trim());
}

async function smoke(packagedTarget, suppliedProjectDir) {
  const temporaryDirectory = await createSmokeDataDirectory();
  const jobsDatabase = path.join(temporaryDirectory, 'jobs.sqlite3');
  let instance;
  try {
    const { target, projectDir } = await prepareSmoke(packagedTarget, temporaryDirectory, suppliedProjectDir);
    await nativeClosureSmoke(target);
    await createV6JobsFixture(target, jobsDatabase);
    instance = await launch(target, temporaryDirectory, projectDir);
    const { health, headers } = await bootstrap(instance);
    const denied = await request(`${instance.baseUrl}/api/gjc/jobs`);
    if (denied.status !== 401) throw new Error(`Unauthenticated API status was ${denied.status}, expected 401.`);
    const jobs = await request(`${instance.baseUrl}/api/gjc/jobs`, { headers });
    const listedJobs = await json(jobs, 'Authenticated GJC job list');
    const preservedJob = Array.isArray(listedJobs.items) ? listedJobs.items.find(item => item?.jobId === 'packaged-v6-preserved-job') : null;
    if (!preservedJob || preservedJob.state !== 'succeeded' || preservedJob.lastSequence !== 1 || listedJobs.nextCursor !== null || Object.hasOwn(preservedJob, 'archivedAt')) throw new Error(`v6 GJC job list was not preserved after migration: ${JSON.stringify(listedJobs)}`);
    const create = await request(`${instance.baseUrl}/api/gjc/jobs`, { headers: { ...headers, 'content-type': 'application/json' }, method: 'POST', body: JSON.stringify({ appSessionId: `smoke-${crypto.randomUUID()}`, projectPath: projectDir, message: 'packaged server smoke' }) });
    const job = await json(create, 'GJC job creation');
    if (create.status !== 202 || typeof job.jobId !== 'string') throw new Error(`GJC job creation returned an invalid response: ${JSON.stringify(job)}`);
    const abort = await request(`${instance.baseUrl}/api/gjc/jobs/${encodeURIComponent(job.jobId)}/abort`, { headers, method: 'POST' });
    if (abort.status !== 202) throw new Error(`GJC job abort failed (${abort.status}).`);
    await stop(instance);
    const migration = await v7MigrationSnapshot(target, jobsDatabase);
    if (migration.migrationVersion !== 7 || migration.archivedAt !== null) throw new Error(`v6 jobs.sqlite3 did not migrate to v7 with archived_at NULL: ${JSON.stringify(migration)}`);
    console.log(`${target.label} packaged server smoke passed: ${JSON.stringify(health)}`);
  } finally {
    if (instance) await stop(instance);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function dataSurvivalSmoke(packagedTarget, suppliedProjectDir) {
  const dataDirectory = await createSmokeDataDirectory();
  const authDatabase = path.join(dataDirectory, 'auth.db');
  const jobsDatabase = path.join(dataDirectory, 'jobs.sqlite3');
  const customName = `data-survival-${crypto.randomUUID()}`;
  let first;
  let second;
  try {
    const { target, projectDir } = await prepareSmoke(packagedTarget, dataDirectory, suppliedProjectDir);
    await nativeClosureSmoke(target);
    first = await launch(target, dataDirectory, projectDir);
    const firstSession = await bootstrap(first);
    const project = await request(`${first.baseUrl}/api/projects/create-project`, { headers: { ...firstSession.headers, 'content-type': 'application/json' }, method: 'POST', body: JSON.stringify({ path: projectDir, customName }) });
    if (!(await json(project, 'Durable project creation')).success) throw new Error('Durable project creation did not report success.');
    const created = await request(`${first.baseUrl}/api/gjc/jobs`, { headers: { ...firstSession.headers, 'content-type': 'application/json' }, method: 'POST', body: JSON.stringify({ appSessionId: `data-survival-${crypto.randomUUID()}`, projectPath: projectDir, message: 'data survival shutdown fence' }) });
    const job = await json(created, 'Durable GJC job creation');
    if (created.status !== 202 || typeof job.jobId !== 'string' || typeof job.appSessionId !== 'string') throw new Error(`Durable GJC job creation returned an invalid response: ${JSON.stringify(job)}`);
    await stop(first); first = undefined;

    const schemaAfterFirstBoot = { auth: await sqliteSnapshot(target, authDatabase), jobs: await sqliteSnapshot(target, jobsDatabase) };
    second = await launch(target, dataDirectory, projectDir);
    const secondSession = await bootstrap(second);
    const list = await json(await request(`${second.baseUrl}/api/gjc/jobs`, { headers: secondSession.headers }), 'Restarted GJC job list');
    if (!Array.isArray(list.items) || !list.items.some(item => item?.jobId === job.jobId && item.state === 'interrupted')) throw new Error(`Restarted GJC job was not preserved as interrupted: ${JSON.stringify(list)}`);
    const replayBeforeResume = await json(await request(`${second.baseUrl}/api/gjc/jobs/${encodeURIComponent(job.jobId)}/events?cursor=0`, { headers: secondSession.headers }), 'Restarted GJC event replay');
    const sequences = replayBeforeResume.events?.map(event => event.sequence);
    if (!Array.isArray(sequences) || sequences.length === 0 || new Set(sequences).size !== sequences.length || !sequences.every((sequence, index) => sequence === index + 1) || !replayBeforeResume.events.some(event => event?.payload?.type === 'interrupted')) throw new Error(`Restarted GJC event replay was not gap-free, unique, and shutdown-preserved: ${JSON.stringify(replayBeforeResume)}`);
    const resumed = await request(`${second.baseUrl}/api/gjc/jobs/${encodeURIComponent(job.jobId)}/resume`, { headers: { ...secondSession.headers, 'content-type': 'application/json' }, method: 'POST', body: JSON.stringify({ appSessionId: job.appSessionId, message: 'data survival resume admission' }) });
    const resumedJob = await json(resumed, 'Interrupted GJC job resume');
    if (resumed.status !== 202 || typeof resumedJob.runId !== 'string') throw new Error(`Interrupted GJC job resume returned an invalid response: ${JSON.stringify(resumedJob)}`);
    const abortResumed = await request(`${second.baseUrl}/api/gjc/jobs/${encodeURIComponent(job.jobId)}/abort`, { headers: secondSession.headers, method: 'POST' });
    if (abortResumed.status !== 202) throw new Error(`Resumed GJC job cleanup abort failed (${abortResumed.status}).`);
    await stop(second); second = undefined;

    const schemaAfterSecondBoot = { auth: await sqliteSnapshot(target, authDatabase), jobs: await sqliteSnapshot(target, jobsDatabase) };
    if (JSON.stringify(schemaAfterFirstBoot) !== JSON.stringify(schemaAfterSecondBoot)) throw new Error('SQLite schema changed across restart; migration was not idempotent.');
    const authRows = await new Promise((resolve, reject) => {
      const source = `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const Database = require('better-sqlite3'); const db = new Database(process.argv[1], { readonly: true }); console.log(JSON.stringify(db.prepare('SELECT custom_project_name FROM projects WHERE custom_project_name = ?').all(process.argv[2]))); db.close();`;
      const child = spawn(target.command, ['--input-type=module', '--eval', source, authDatabase, customName], { cwd: target.cwd, env: target.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(`Durable auth row inspection failed (${code}): ${stderr}`)));
    });
    if (!Array.isArray(authRows) || authRows.length !== 1) throw new Error('Durable auth.db project row did not survive restart.');
    console.log(`${target.label} packaged data-survival smoke passed: job=${job.jobId}, events=${sequences.length}, schemas=idempotent`);
  } finally {
    if (first) await stop(first);
    if (second) await stop(second);
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

export async function runPackagedSmoke(args = process.argv.slice(2)) {
  const options = parseSmokeOptions(args);
  const location = await smokeLocation(options.app, options);
  try {
    const target = await packagedTargets(location.app, options);
    await (options.dataSurvival ? dataSurvivalSmoke(target, options.projectDir) : smoke(target, options.projectDir));
  } finally {
    await location.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runPackagedSmoke();
