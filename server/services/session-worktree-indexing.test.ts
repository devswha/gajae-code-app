import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { closeConnection, initializeDatabase, projectPermissionsDb, projectsDb, sessionsDb, sessionWorktreesDb } from '../modules/database/index.js';
import { resolveProjectRunPermissions } from '../modules/projects/index.js';
import { GjcSessionSynchronizer } from '../modules/providers/list/gjc/gjc-session-synchronizer.provider.js';
import { sessionsService } from '../modules/providers/services/sessions.service.js';

import { GjcGitClient } from './gjc-git-client.js';
import { readSessionLocation, resolveSessionWorkspacePath } from './session-worktree-paths.js';

const execFile = promisify(execFileCallback);
const bun = path.join(process.cwd(), 'dist-native', process.platform === 'win32' ? 'bun.exe' : 'bun');

// Real SDK serialization in Bun; the application's actual synchronizer and
// SQLite code run in Node. No AgentSession, broker, model or credentials exist.
const writeSdkTranscript = `
  import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
  const input = JSON.parse(process.argv.at(-1));
  const manager = input.file
    ? await SessionManager.open(input.file, input.destination)
    : SessionManager.create(input.cwd, input.destination);
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: input.message }], timestamp: Date.now() });
  await manager.ensureOnDisk();
  const result = { id: manager.getSessionId(), file: manager.getSessionFile(), cwd: manager.getCwd() };
  const closed = await manager.flushAndCloseStrict();
  if (closed.kind !== 'closed') throw new Error('Fixture transcript close was not confirmed');
  console.log(JSON.stringify(result));
`;

async function fixture(t: test.TestContext, sameIdentity = false) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'session-worktree-indexing-')));
  const priorDatabase = process.env.DATABASE_PATH;
  const priorLiveRoot = process.env.GJC_LIVE_SESSION_DIR;
  const priorHome = os.homedir;
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'app.db');
  process.env.GJC_LIVE_SESSION_DIR = path.join(root, 'live-sessions');
  os.homedir = () => root;
  await initializeDatabase();
  const repository = path.join(root, 'repository');
  const destination = path.join(root, '.gjc', 'agent', 'sessions', 'sdk-worktree');
  await mkdir(repository);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
    && !['TMUX', 'TMUX_PANE', 'KITTY_WINDOW_ID', 'TERM_SESSION_ID', 'WT_SESSION'].includes(key)));
  const gitCommand = (...args: string[]) => execFile('git', [
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(root, 'no-hooks')}`,
    '-c', 'user.name=Index Test', '-c', 'user.email=index@example.test', ...args,
  ], { cwd: repository, env: { ...environment, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  await gitCommand('init');
  await writeFile(path.join(repository, 'README.md'), 'fixture\n');
  await gitCommand('add', 'README.md');
  await gitCommand('commit', '-m', 'fixture');
  const project = projectsDb.createProjectPath(repository).project!;
  projectPermissionsDb.setMode(repository, 'bypass', { acknowledgeBypass: true });
  const git = new GjcGitClient({ workdir: repository });
  const jobId = 'job-index-fixture';
  const cwd = path.join(repository, '.gjc-worktrees', jobId);
  await git.create({ jobId, path: cwd, branch: `job/${jobId}` });
  const write = async (message: string, file?: string) => {
    const { stdout } = await execFile(bun, ['--eval', writeSdkTranscript, JSON.stringify({ cwd, destination, message, file })], {
      cwd: process.cwd(), env: environment, timeout: 15_000, maxBuffer: 256 * 1024,
    });
    return JSON.parse(stdout.trim()) as { id: string; file: string; cwd: string };
  };
  t.after(async () => {
    git.close();
    closeConnection();
    os.homedir = priorHome;
    if (priorDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = priorDatabase;
    if (priorLiveRoot === undefined) delete process.env.GJC_LIVE_SESSION_DIR;
    else process.env.GJC_LIVE_SESSION_DIR = priorLiveRoot;
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const transcript = await write('SDK-written worktree message');
  const appId = sameIdentity ? transcript.id : 'app-index-fixture';
  sessionsDb.createAppSession(appId, 'gjc', repository);
  sessionWorktreesDb.create(appId, jobId, repository);
  sessionWorktreesDb.setPreparedPath(appId, jobId, cwd);
  return { root, repository, project, cwd, jobId, appId, transcript, write };
}

test('SDK-written worktree transcripts keep their parent project through watcher updates, full scans and reopen', async (t) => {
  const f = await fixture(t);
  sessionsDb.assignProviderSessionId(f.appId, 'gjc', f.transcript.id);
  const checkBinding = async () => {
    const row = sessionsDb.getSessionById(f.appId)!;
    assert.equal(row.project_path, f.repository);
    assert.equal(row.provider_session_id, f.transcript.id);
    assert.equal(row.jsonl_path, f.transcript.file);
    assert.equal(resolveProjectRunPermissions(row.project_path).mode, 'bypass');
    assert.equal(await resolveSessionWorkspacePath(f.project.project_id, f.appId), f.cwd);
    assert.equal(readSessionLocation(f.appId).projectPath, f.repository);
    assert.equal(sessionsDb.countSessionsByProjectPath(f.repository), 1);
    assert.equal(sessionsDb.countSessionsByProjectPath(f.cwd), 0);
  };
  const synchronizer = new GjcSessionSynchronizer();
  assert.equal(await synchronizer.synchronizeFile(f.transcript.file), f.appId);
  await checkBinding();
  assert.equal((await synchronizer.reconcile(new Date(0))).processed, 1);
  await checkBinding();
  const appended = await f.write('SDK-written message after reopening', f.transcript.file);
  assert.equal(appended.id, f.transcript.id);
  closeConnection();
  await initializeDatabase();
  assert.equal(await new GjcSessionSynchronizer().synchronize(), 1);
  await checkBinding();
  const history = await sessionsService.fetchHistory(f.appId);
  assert.ok(history.messages.some((message) => String(message.content).includes('after reopening')));
  const header = JSON.parse((await readFile(f.transcript.file, 'utf8')).split('\n')[0]);
  assert.equal(header.cwd, f.cwd);
});

test('a watcher that discovers the real SDK transcript before provider binding merges into the owning app session', async (t) => {
  const f = await fixture(t);
  const synchronizer = new GjcSessionSynchronizer();
  assert.equal(await synchronizer.synchronizeFile(f.transcript.file), f.transcript.id);
  assert.equal(sessionsDb.getSessionById(f.appId)?.project_path, f.repository);
  sessionsDb.assignProviderSessionId(f.appId, 'gjc', f.transcript.id);
  await synchronizer.reconcile(new Date(0));
  assert.equal(sessionsDb.getAllSessions().length, 1);
  assert.equal(sessionsDb.getSessionById(f.appId)?.project_path, f.repository);
  assert.equal(sessionsDb.getSessionById(f.appId)?.jsonl_path, f.transcript.file);
  assert.equal(readSessionLocation(f.appId).cwd, f.cwd);
});

test('an SDK transcript whose provider id equals a pending bound app id cannot overwrite its owning project', async (t) => {
  const f = await fixture(t, true);
  assert.equal(sessionsDb.getSessionById(f.appId)?.provider_session_id, null);
  await new GjcSessionSynchronizer().synchronizeFile(f.transcript.file);
  assert.equal(sessionsDb.getSessionById(f.appId)?.project_path, f.repository);
  assert.equal(sessionsDb.getSessionById(f.appId)?.provider_session_id, f.transcript.id);
  assert.equal(readSessionLocation(f.appId).cwd, f.cwd);
});

test('a transcript id collision cannot replace a bound session with a different provider identity', async (t) => {
  const f = await fixture(t, true);
  sessionsDb.assignProviderSessionId(f.appId, 'gjc', 'already-bound-provider');
  await assert.rejects(new GjcSessionSynchronizer().synchronizeFile(f.transcript.file), /Transcript identity conflicts/);
  assert.equal(sessionsDb.getSessionById(f.appId)?.provider_session_id, 'already-bound-provider');
  assert.equal(sessionsDb.getSessionById(f.appId)?.project_path, f.repository);
  assert.equal(readSessionLocation(f.appId).cwd, f.cwd);
});

test('provider announcement cannot merge away another worktree session and cascade-delete its binding', async (t) => {
  const f = await fixture(t);
  sessionsDb.assignProviderSessionId(f.appId, 'gjc', f.transcript.id);
  await new GjcSessionSynchronizer().synchronizeFile(f.transcript.file);
  sessionsDb.createAppSession('competing-app-session', 'gjc', f.repository);
  assert.throws(() => sessionsDb.assignProviderSessionId('competing-app-session', 'gjc', f.transcript.id), /already belongs to a bound worktree session/);
  assert.equal(sessionsDb.getSessionById('competing-app-session')?.provider_session_id, null);
  assert.equal(sessionsDb.getSessionById(f.appId)?.provider_session_id, f.transcript.id);
  assert.equal(sessionsDb.getSessionById(f.appId)?.project_path, f.repository);
  assert.equal(readSessionLocation(f.appId).cwd, f.cwd);
  closeConnection();
  await initializeDatabase();
  await new GjcSessionSynchronizer().reconcile(new Date(0));
  assert.equal(sessionsDb.getSessionById(f.appId)?.project_path, f.repository);
  assert.equal(readSessionLocation(f.appId).cwd, f.cwd);
});
