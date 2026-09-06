import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { gjcSearchFile, gjcSearchMessages } from '@/modules/providers/services/gjc-conversation-search.js';
import { sessionConversationsSearchService } from '@/modules/providers/services/session-conversations-search.service.js';

type Entry = Record<string, unknown>;
type SearchInput = Parameters<typeof sessionConversationsSearchService.search>[0];
type Progress = Parameters<NonNullable<SearchInput['onProgress']>>[0];
const timestamp = '2026-09-05T12:00:00.000Z';
const message = (id: string, role: string, content: unknown, extra: Entry = {}): Entry => ({
  type: 'message', id, timestamp, message: { role, content, ...extra },
});
const skill = (extra: Entry = {}): Entry => ({
  type: 'custom_message', id: 'skill-request', timestamp,
  customType: 'skill-prompt', display: true, attribution: 'user',
  details: { name: 'review', args: '한국어 fix "quoted" C:\\repo', path: '/private/SKILL.md' },
  content: 'EXPANDED_SECRET_PROMPT should never be searchable', ...extra,
});
const encode = (entries: unknown[]): string => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;

async function fixture(t: TestContext) {
  const cache = path.join(process.cwd(), 'node_modules', '.cache');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'gjc-conversation-search-'));
  const originalHome = os.homedir;
  const originalDatabase = process.env.DATABASE_PATH;
  const originalLiveDir = process.env.GJC_LIVE_SESSION_DIR;
  const live = path.join(root, 'live-sessions');
  const cli = path.join(root, '.gjc', 'agent', 'sessions');
  const project = path.join(root, 'workspace');
  await Promise.all([live, cli, project].map((dir) => mkdir(dir, { recursive: true })));
  closeConnection();
  os.homedir = () => root;
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.GJC_LIVE_SESSION_DIR = live;
  t.after(async () => {
    closeConnection();
    os.homedir = originalHome;
    if (originalDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabase;
    if (originalLiveDir === undefined) delete process.env.GJC_LIVE_SESSION_DIR;
    else process.env.GJC_LIVE_SESSION_DIR = originalLiveDir;
    await rm(root, { recursive: true, force: true });
  });
  await initializeDatabase();
  const add = async (id: string, entries: unknown[], options: {
    file?: string; project?: string; appId?: string; title?: string; header?: Entry;
  } = {}) => {
    const file = options.file ?? path.join(live, `${id}.jsonl`);
    const cwd = options.project ?? project;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, encode([
      { type: 'session', id, version: 3, timestamp, cwd, ...options.header }, ...entries,
    ]));
    if (options.appId) {
      sessionsDb.createAppSession(options.appId, 'gjc', cwd);
      sessionsDb.assignProviderSessionId(options.appId, 'gjc', id);
    }
    const sessionId = sessionsDb.createSession(id, 'gjc', cwd, options.title, timestamp, timestamp, file);
    return { file, sessionId, projectId: projectsDb.getProjectPath(cwd)!.project_id };
  };
  return { root, live, cli, project, add };
}

async function search(query: string, options: Partial<SearchInput> = {}) {
  const updates: Progress[] = [];
  await sessionConversationsSearchService.search({
    query, limit: 50, ...options, onProgress: (update) => { updates.push(update); options.onProgress?.(update); },
  });
  const projects = updates.flatMap(({ projectResult }) => projectResult ? [projectResult] : []);
  const sessions = projects.flatMap((project) => project.sessions);
  const matches = sessions.flatMap((session) => session.matches);
  return { projects, sessions, matches, updates };
}

test('search reads app and CLI GJC transcripts and preserves app identity, titles, snippets, and highlights', async (t) => {
  const f = await fixture(t);
  const app = await f.add('sdk-identity', [
    message('user', 'user', [{ type: 'text', text: 'Find NeedLe in this project' }, { type: 'image', data: 'IMAGE_SECRET' }]),
    message('assistant', 'assistant', [{ type: 'text', text: 'needle\nanswer' }]),
    message('third', 'assistant', 'needle third match'),
  ], { appId: 'app-identity', title: 'My conversation' });
  await f.add('cli-session', [message('cli-user', 'user', 'CLI needle request')], {
    file: path.join(f.cli, 'workspace-slug', 'cli.jsonl'),
  });
  projectsDb.updateCustomProjectName(f.project, 'Named project');

  const result = await search(' needle ');
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].projectId, app.projectId);
  assert.equal(result.projects[0].projectDisplayName, 'Named project');
  assert.equal(result.matches.length, 3);
  const session = result.sessions.find(({ sessionId }) => sessionId === 'app-identity')!;
  assert.equal(session.provider, 'gjc');
  assert.equal(session.sessionSummary, 'My conversation');
  assert.deepEqual(session.matches.map(({ role, messageUuid, timestamp: time }) => ({ role, messageUuid, time })), [
    { role: 'user', messageUuid: 'user', time: timestamp },
    { role: 'assistant', messageUuid: 'assistant', time: timestamp },
  ]);
  assert.equal(session.matches[1].snippet, 'needle answer');
  for (const match of result.matches) {
    assert.equal(match.provider, 'gjc');
    assert.equal(match.snippet.slice(match.highlights[0].start, match.highlights[0].end).toLowerCase(), 'needle');
  }
  assert.equal((await search('IMAGE_SECRET')).matches.length, 0);
});

test('skill search uses validated concise metadata, including commands absent from raw JSONL', async (t) => {
  const f = await fixture(t);
  const { file } = await f.add('skill-session', [skill()]);
  assert.equal((await readFile(file, 'utf8')).includes('/skill:review'), false);
  const result = await search('/skill:review');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].role, 'user');
  assert.equal(result.matches[0].snippet, '/skill:review 한국어 fix "quoted" C:\\repo');
  assert.equal(result.sessions[0].sessionSummary, '/skill:review 한국어 fix "quoted" C:\\repo');
  assert.deepEqual(result.matches[0].highlights, [{ start: 0, end: 13 }]);
  for (const query of ['한국어', '"quoted"', 'C:\\repo']) assert.equal((await search(query)).matches.length, 1, query);
  for (const query of ['EXPANDED_SECRET_PROMPT', '/private/SKILL.md']) assert.equal((await search(query)).matches.length, 0, query);
  await f.add('skill-no-args', [skill({ details: { name: 'no-args' } })]);
  assert.equal((await search('/skill:no-args')).matches[0].snippet, '/skill:no-args');
});

test('hidden, malformed, and non-user skills never expose their metadata or expanded content', async (t) => {
  const f = await fixture(t);
  const invalid: Entry[] = [
    { display: false }, { display: undefined }, { display: 'true' },
    { attribution: 'agent' }, { attribution: undefined },
    { customType: 'other' }, { type: 'custom' },
    { details: null }, { details: [] }, { details: 'review' },
    { details: { name: '' } }, { details: { name: '../review' } },
    { details: { name: 'review\nforged' } }, { details: { name: 3 } },
    { details: { name: 'review', args: {} } }, { details: { name: 'review', args: null } },
    { details: { name: 'review', args: ['quoted'] } },
  ];
  await f.add('ignored-skills', invalid.map((entry) => skill(entry)));
  for (const query of ['review', 'quoted', 'EXPANDED_SECRET_PROMPT', 'SKILL.md']) {
    assert.equal((await search(query)).matches.length, 0, query);
  }
});

test('normal text is decoded before phrase matching; controls, tools, hidden messages, and non-text parts are excluded', async (t) => {
  const f = await fixture(t);
  const { file } = await f.add('ordinary', [
    { type: 'compaction', summary: 'CONTROL_SECRET' },
    message('hidden', 'user', 'HIDDEN_SECRET', { display: false }),
    message('system', 'system', 'SYSTEM_SECRET'),
    message('tool', 'toolResult', 'TOOL_SECRET'),
    message('parts', 'assistant', [null, 3, {},
      { type: 'thinking', thinking: 'THINKING_SECRET' },
      { type: 'toolCall', name: 'TOOL_CALL_SECRET', arguments: {} },
      { type: 'text', text: 'needle far away answer' },
    ]),
    message('user', 'user', 'literal C:\\repo "quoted"'),
    message('reply', 'assistant', [{ type: 'text', text: 'needle\nanswer' }]),
  ]);
  await appendFile(file, '\n{"type":"message","id":"unicode","message":{"role":"user","content":"\\uD55C\\uAE00"}}');
  assert.equal((await search('한글')).matches.length, 1);
  const phrase = await search('NEEDLE answer');
  assert.equal(phrase.matches.length, 1);
  assert.equal(phrase.matches[0].messageUuid, 'reply');
  assert.deepEqual(phrase.matches[0].highlights, [{ start: 0, end: 13 }]);
  assert.equal((await search('C:\\repo "quoted"')).matches.length, 1);
  for (const query of ['CONTROL_SECRET', 'HIDDEN_SECRET', 'SYSTEM_SECRET', 'TOOL_SECRET', 'THINKING_SECRET', 'TOOL_CALL_SECRET']) {
    assert.equal((await search(query)).matches.length, 0, query);
  }
});

test('search skips malformed, oversized, and truncated lines and sees fresh on-disk appends', async (t) => {
  const f = await fixture(t);
  const { file } = await f.add('malformed', [null, [], 3, { type: 'message', message: null }]);
  await appendFile(file, `bad json\r\n\n${JSON.stringify(message('oversized', 'user', 'x'.repeat(32 * 1024 * 1024)))}\n`);
  await appendFile(file, `${JSON.stringify(message('after-large', 'user', 'fresh needle'))}\r\n{"broken":`);
  assert.equal((await search('needle')).matches[0].messageUuid, 'after-large');
  assert.equal((await search('appended')).matches.length, 0);
  await appendFile(file, `\n${JSON.stringify(message('appended', 'assistant', 'newly appended'))}`);
  assert.equal((await search('appended')).matches[0].messageUuid, 'appended');
});

test('project scope is applied before limits and excludes unknown and archived projects/sessions', async (t) => {
  const f = await fixture(t);
  await f.add('other', [message('other-user', 'user', 'needle')], { project: path.join(f.root, 'other-project') });
  const selected = await f.add('selected', [message('user', 'user', 'needle')]);
  await f.add('archived-session', [message('archived', 'user', 'needle')]);
  sessionsDb.updateSessionIsArchived('archived-session', true);
  const archivedProject = path.join(f.root, 'archived-project');
  await f.add('archived-project-session', [message('archived-project-user', 'user', 'needle')], { project: archivedProject });
  projectsDb.updateProjectIsArchived(archivedProject, true);

  const scoped = await search('needle', { projectId: selected.projectId, limit: 1 });
  assert.deepEqual(scoped.sessions.map(({ sessionId }) => sessionId), ['selected']);
  assert.equal(scoped.updates[0].totalProjects, 1);
  assert.equal((await search('needle', { projectId: 'missing-project' })).matches.length, 0);
  assert.equal((await search('needle', { projectId: projectsDb.getProjectPath(archivedProject)!.project_id })).matches.length, 0);
  assert.deepEqual((await search('needle')).sessions.map(({ sessionId }) => sessionId).sort(), ['other', 'selected']);
});

test('search enforces per-session/global limits and cancellation', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 102; index++) {
    await f.add(`limit-${index}`, [0, 1, 2].map((part) => message(`m-${part}`, 'user', 'needle')), {
      project: path.join(f.root, `project-${index}`),
    });
  }
  for (const [limit, expected] of [[1.8, 1], [0, 1], [3, 3], [Number.NaN, 50], [999, 200]]) {
    const result = await search('needle', { limit });
    assert.equal(result.matches.length, expected);
    assert.ok(result.sessions.every(({ matches }) => matches.length <= 2));
    assert.equal(result.updates.at(-1)?.totalMatches, expected);
  }
  const controller = new AbortController();
  const result = await search('needle', { signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(result.projects.length, 1);
  assert.equal((await search('needle', { signal: controller.signal })).matches.length, 0);
  assert.equal((await search('   ')).matches.length, 0);
});

test('worktree transcript cwd does not replace the logical project scope or prevent matches', async (t) => {
  const f = await fixture(t);
  await f.add('unrelated', [message('other', 'user', 'needle')], { project: path.join(f.root, 'other-project') });
  const actualCwd = path.join(f.project, '.worktrees', 'session-one');
  await mkdir(actualCwd, { recursive: true });
  const session = await f.add('worktree-sdk', [message('worktree-user', 'user', 'worktree needle')], {
    appId: 'worktree-app', header: { cwd: actualCwd },
  });
  const scoped = await search('needle', { projectId: session.projectId, limit: 1 });
  assert.equal(scoped.projects[0]?.projectName, f.project);
  assert.equal(scoped.projects[0]?.projectId, session.projectId);
  assert.deepEqual(scoped.sessions.map(({ sessionId }) => sessionId), ['worktree-app']);
  assert.equal(scoped.matches[0]?.snippet, 'worktree needle');
  assert.ok((await search('needle')).sessions.some(({ sessionId }) => sessionId === 'worktree-app'));
  const otherId = projectsDb.getProjectPath(path.join(f.root, 'other-project'))!.project_id;
  assert.deepEqual((await search('needle', { projectId: otherId })).sessions.map(({ sessionId }) => sessionId), ['unrelated']);
});

test('opened handles replaced with a FIFO or directory are rejected before streaming', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const { file } = await f.add('replaced', [message('user', 'user', 'needle')]);
  const handle = await open(file, 'r');
  const createReadStream = handle.createReadStream;
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  let streams = 0;
  t.mock.method(prototype, 'createReadStream', function (this: typeof handle, ...args: Parameters<typeof createReadStream>) {
    streams += 1;
    return createReadStream.apply(this, args);
  });
  const collect = async () => {
    const entries = [];
    for await (const entry of gjcSearchMessages(file, 'replaced', () => false)) entries.push(entry);
    return entries;
  };
  assert.equal((await collect()).length, 1);
  assert.equal(streams, 1, 'the spy observes regular-file streams');
  streams = 0;
  assert.equal(await gjcSearchFile(file, [f.live]), file);
  await rm(file);
  execFileSync('mkfifo', [file]);
  assert.deepEqual(await collect(), []);
  assert.equal(streams, 0, 'a FIFO swapped after candidate validation is never streamed');
  await rm(file);
  await mkdir(file);
  assert.deepEqual(await collect(), []);
  assert.equal(streams, 0, 'directories are also rejected at the opened-handle boundary');
});

test('GJC search rejects outside files, symlinks, sidecars, missing paths, and mismatched session headers', async (t) => {
  const f = await fixture(t);
  const entries = [message('user', 'user', 'boundary needle')];
  await f.add('valid', entries);
  const outside = await f.add('outside', entries, { file: path.join(f.root, 'outside', 'outside.jsonl') });
  await f.add('prefix', entries, { file: path.join(`${f.live}-sibling`, 'prefix.jsonl') });
  await f.add('nested', entries, { file: path.join(f.live, 'slug', 'session-sidecar', 'nested.jsonl') });
  await f.add('extension', entries, { file: path.join(f.live, 'extension.txt') });
  await f.add('wrong-id', entries, { header: { id: 'different-sdk-session' } });
  await f.add('invalid-cwd', entries, { header: { cwd: 7 } });
  await f.add('relative-cwd', entries, { header: { cwd: 'workspace' } });
  await f.add('no-header', entries, { header: { type: 'custom' } });
  const addPath = (id: string, file: string) => sessionsDb.createSession(id, 'gjc', f.project, undefined, timestamp, timestamp, file);
  const link = path.join(f.live, 'leaf-link.jsonl');
  const leafTarget = path.join(f.root, 'outside', 'leaf-target.jsonl');
  await writeFile(leafTarget, encode([{ type: 'session', id: 'leaf-link', cwd: f.project }, ...entries]));
  await symlink(leafTarget, link);
  addPath('leaf-link', link);
  const directoryLink = path.join(f.live, 'dir-link');
  await symlink(path.dirname(outside.file), directoryLink, 'dir');
  await writeFile(path.join(f.root, 'outside', 'dir-target.jsonl'), encode([{ type: 'session', id: 'dir-link', cwd: f.project }, ...entries]));
  addPath('dir-link', path.join(directoryLink, 'dir-target.jsonl'));
  addPath('missing', path.join(f.live, 'missing.jsonl'));
  const directory = path.join(f.live, 'directory.jsonl');
  await mkdir(directory);
  addPath('directory', directory);
  const relative = await f.add('relative', entries);
  addPath('relative', path.relative(process.cwd(), relative.file));
  await f.add('traversal', entries, { file: `${f.live}/../outside/traversal.jsonl` });
  sessionsDb.createAppSession('not-started', 'gjc', f.project);

  assert.deepEqual((await search('needle')).sessions.map(({ sessionId }) => sessionId), ['valid']);
  const rootLink = path.join(f.root, 'root-link');
  await symlink(f.live, rootLink, 'dir');
  process.env.GJC_LIVE_SESSION_DIR = rootLink;
  assert.equal((await search('needle')).matches.length, 0, 'a symlinked session root is not an allowed root');
});

test('adding GJC preserves legacy Claude and Codex search results', async (t) => {
  const f = await fixture(t);
  const entries: Array<[string, Entry]> = [
    ['claude', { sessionId: 'legacy-claude', uuid: 'claude-message', timestamp, message: { role: 'user', content: 'legacy needle' } }],
    ['codex', { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'legacy needle' }] } }],
  ];
  for (const [provider, entry] of entries) {
    const file = path.join(f.root, `${provider}.jsonl`);
    await writeFile(file, encode([entry]));
    sessionsDb.createSession(`legacy-${provider}`, provider, f.project, undefined, timestamp, timestamp, file);
  }
  await f.add('gjc', [message('user', 'user', 'GJC needle')]);
  assert.deepEqual((await search('needle')).sessions.map(({ provider }) => provider).sort(), ['claude', 'codex', 'gjc']);
});

async function routeRequest(query: Record<string, string>) {
  const [{ default: express }, { default: router }] = await Promise.all([
    import('express'), import('@/modules/providers/provider.routes.js'),
  ]);
  const server = express().use('/api/providers', router).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/providers/search/sessions?${new URLSearchParams(query)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    const events = body.trim().split('\n\n').filter(Boolean).map((frame) => {
      const [event, data] = frame.split('\n');
      return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
    });
    return { response, body, events };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('search SSE route streams real GJC skill hits with the existing result shape and a done event', async (t) => {
  const f = await fixture(t);
  const session = await f.add('sdk-route', [skill()], { appId: 'app-route' });
  const { response, events, body } = await routeRequest({ q: '/skill:review', limit: '1' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^text\/event-stream/);
  assert.deepEqual(events.map(({ event }) => event), ['result', 'done']);
  const result = events[0].data as Progress;
  assert.equal(result.totalMatches, 1);
  assert.equal(result.scannedProjects, 1);
  assert.equal(result.totalProjects, 1);
  assert.equal(result.projectResult?.projectId, session.projectId);
  assert.equal(result.projectResult?.sessions[0].sessionId, 'app-route');
  assert.equal(result.projectResult?.sessions[0].provider, 'gjc');
  assert.equal(result.projectResult?.sessions[0].matches[0].snippet, '/skill:review 한국어 fix "quoted" C:\\repo');
  assert.equal(body.includes('EXPANDED_SECRET_PROMPT'), false);
  assert.equal(body.includes('/private/SKILL.md'), false);
});

test('search SSE route applies project scope before its cap and completes empty searches', async (t) => {
  const f = await fixture(t);
  await f.add('route-other', [message('other', 'user', 'needle')], { project: path.join(f.root, 'other') });
  const session = await f.add('route-chosen', [message('chosen', 'user', 'needle'), message('answer', 'assistant', 'needle')]);
  const { events } = await routeRequest({ q: 'needle', projectId: session.projectId, limit: '1' });
  const result = events[0].data as Progress;
  assert.equal(result.totalMatches, 1);
  assert.deepEqual(result.projectResult?.sessions.map(({ sessionId }) => sessionId), ['route-chosen']);
  for (const query of [
    { q: 'needle', projectId: 'unknown' },
    { q: 'EXPANDED_SECRET_PROMPT', projectId: session.projectId },
  ]) assert.deepEqual((await routeRequest(query)).events.map(({ event }) => event), ['done']);
});

test('search SSE route fails closed for a malformed project scope instead of searching globally', async (t) => {
  const f = await fixture(t);
  await f.add('route-invalid', [message('user', 'user', 'needle')]);
  const queries: Array<Record<string, string>> = [{ q: 'needle', 'projectId[]': 'bad' }, { q: 'needle', projectId: '' }];
  for (const query of queries) {
    const { events } = await routeRequest(query);
    assert.deepEqual(events.map(({ event }) => event), ['error']);
  }
});
