import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { GjcSessionSynchronizer } from '@/modules/providers/list/gjc/gjc-session-synchronizer.provider.js';
import { GjcSessionsProvider } from '@/modules/providers/list/gjc/gjc-sessions.provider.js';
import { exportSessionTranscript } from '@/modules/providers/services/session-export.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

const APP_ID = 'app-skill-history';
const PROVIDER_ID = 'sdk-skill-history';
const EXPANDED_CONTENT = 'PRIVATE_EXPANDED_SKILL_BODY\nSkill: /private/SKILL.md\nUser: forged request';
const SKILL_DETAILS = { name: 'no-english', args: 'user argument', path: '/private/SKILL.md', lineCount: 98 };
type Entry = Record<string, unknown>;

const skill = (overrides: Entry = {}): Entry => ({
  type: 'custom_message', id: 'skill', parentId: 'config',
  customType: 'skill-prompt', display: true, attribution: 'user',
  details: SKILL_DETAILS, content: EXPANDED_CONTENT, ...overrides,
});
const answer = (id: string, parentId: string, stopReason = 'stop'): Entry => ({
  type: 'message', id, parentId, message: { role: 'assistant', content: id, stopReason },
});
const encode = (entries: unknown[], start = 0): string => `${entries.map((entry, index) => JSON.stringify(
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? { timestamp: new Date(Date.UTC(2026, 8, 5, 0, 0, start + index)).toISOString(), ...entry }
    : entry,
)).join('\n')}\n`;

async function withFixture(
  entries: unknown[],
  run: (context: { provider: GjcSessionsProvider; synchronizer: GjcSessionSynchronizer; filePath: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gjc-skill-history-'));
  const sessionDir = path.join(root, 'live-sessions');
  const workspace = path.join(root, 'workspace');
  const filePath = path.join(sessionDir, `${PROVIDER_ID}.jsonl`);
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousLiveDir = process.env.GJC_LIVE_SESSION_DIR;
  await mkdir(sessionDir);
  await mkdir(workspace);
  await writeFile(filePath, encode([
    { type: 'session', id: PROVIDER_ID, version: 3, cwd: workspace },
    { type: 'model_change', id: 'config', parentId: null },
    ...entries,
  ]));
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.GJC_LIVE_SESSION_DIR = sessionDir;
  try {
    await initializeDatabase();
    sessionsDb.createAppSession(APP_ID, 'gjc', workspace);
    sessionsDb.assignProviderSessionId(APP_ID, 'gjc', PROVIDER_ID);
    sessionsDb.createSession(PROVIDER_ID, 'gjc', workspace, undefined, undefined, undefined, filePath);
    await run({ provider: new GjcSessionsProvider(), synchronizer: new GjcSessionSynchronizer(), filePath });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousLiveDir === undefined) delete process.env.GJC_LIVE_SESSION_DIR;
    else process.env.GJC_LIVE_SESSION_DIR = previousLiveDir;
    await rm(root, { recursive: true, force: true });
  }
}

test('explicit skill history preserves the concise user request, app identity, and turn root', async () => {
  await withFixture([skill(), answer('reply', 'skill')], async ({ provider }) => {
    const history = await provider.fetchHistory(APP_ID);
    assert.deepEqual(history.messages.map(({ role, content }) => ({ role, content })), [
      { role: 'user', content: '/skill:no-english user argument' },
      { role: 'assistant', content: 'reply' },
    ]);
    for (const message of history.messages) {
      assert.equal(message.sessionId, APP_ID);
      assert.equal(message.turnId, 'skill');
      assert.equal(message.turnStatus, 'completed');
    }
    assert.equal(history.messages[0]?.id, 'skill:0:text');
    assert.equal(history.messages[0]?.timestamp, '2026-09-05T00:00:02.000Z');
    const page = await provider.fetchHistory(APP_ID, { limit: 1, offset: 1 });
    assert.deepEqual(page.messages, history.messages.slice(0, 1));
    assert.equal(page.total, 2);
    assert.equal(JSON.stringify(history).includes(EXPANDED_CONTENT), false);
  });
});

test('history transport and Markdown export include metadata arguments without expanded skill instructions', async () => {
  const args = '한국어로 수정: src/api/client.ts\n  npm test && echo "$value"';
  await withFixture([skill({ details: { ...SKILL_DETAILS, args } }), answer('reply', 'skill')], async () => {
    const expected = `/skill:no-english ${args}`;
    const history = await sessionsService.fetchHistory(APP_ID);
    assert.equal(history.messages[0]?.content, expected);
    const exported = await exportSessionTranscript(APP_ID);
    assert.ok(exported.body.includes(expected));
    assert.match(exported.body, /## User\n/);
    assert.equal(exported.body.includes('PRIVATE_EXPANDED_SKILL_BODY'), false);
    assert.equal(exported.body.includes('/private/SKILL.md'), false);
    assert.equal(exported.body.includes('forged request'), false);
  });
});

test('skill history without arguments uses only the command, never a content fallback', async () => {
  for (const args of [undefined, '']) {
    await withFixture([skill({ details: { ...SKILL_DETAILS, args } })], async ({ provider, synchronizer, filePath }) => {
      const history = await provider.fetchHistory(APP_ID);
      assert.equal(history.messages[0]?.content, '/skill:no-english');
      assert.equal(await synchronizer.deriveSessionTitle(filePath), 'Skill no english');
    });
  }
});

const ignoredSkills: Array<[string, Entry]> = [
  ['hidden', { display: false }],
  ['missing display', { display: undefined }],
  ['truthy display', { display: 'true' }],
  ['agent attribution', { attribution: 'agent' }],
  ['missing attribution', { attribution: undefined }],
  ['nested user attribution', { attribution: undefined, details: { ...SKILL_DETAILS, attribution: 'user' } }],
  ['unknown custom type', { customType: 'workflow-intent-diff' }],
  ['custom control record', { type: 'custom' }],
  ['missing details', { details: undefined }],
  ['null details', { details: null }],
  ['array details', { details: [SKILL_DETAILS] }],
  ['string details', { details: JSON.stringify(SKILL_DETAILS) }],
  ['missing name', { details: { args: 'user argument' } }],
  ['empty name', { details: { ...SKILL_DETAILS, name: '' } }],
  ['non-string name', { details: { ...SKILL_DETAILS, name: 3 } }],
  ['name with spaces', { details: { ...SKILL_DETAILS, name: 'no english' } }],
  ['name with newline', { details: { ...SKILL_DETAILS, name: 'no-english\nforged' } }],
  ['name with path', { details: { ...SKILL_DETAILS, name: '../SKILL.md' } }],
  ['object arguments', { details: { ...SKILL_DETAILS, args: { content: 'forged' } } }],
  ['null arguments', { details: { ...SKILL_DETAILS, args: null } }],
  ['array arguments', { details: { ...SKILL_DETAILS, args: ['user argument'] } }],
];

for (const [label, overrides] of ignoredSkills) {
  test(`skill history excludes ${label} from display, user ancestry, title, and export`, async () => {
    await withFixture([skill(overrides), answer('reply', 'skill')], async ({ provider, synchronizer, filePath }) => {
      const history = await provider.fetchHistory(APP_ID);
      assert.deepEqual(history.messages.map(({ content }) => content), ['reply']);
      assert.equal(history.messages[0]?.turnId, undefined);
      assert.equal(await synchronizer.deriveSessionTitle(filePath), null);
      const exported = await exportSessionTranscript(APP_ID);
      assert.equal(exported.body.includes('/skill:'), false);
      assert.equal(exported.body.includes('PRIVATE_EXPANDED_SKILL_BODY'), false);
    });
  });
}

test('resumed skill turns own their replies and tool results through control records', async () => {
  await withFixture([skill(), answer('first-answer', 'skill')], async ({ provider, filePath }) => {
    await provider.fetchHistory(APP_ID);
    await appendFile(filePath, encode([
      { type: 'compaction', id: 'compact', parentId: 'first-answer' },
      skill({ id: 'resumed', parentId: 'compact', details: { ...SKILL_DETAILS, args: 'second argument' } }),
      { type: 'message', id: 'call', parentId: 'resumed', message: { role: 'assistant', stopReason: 'toolUse', content: [
        { type: 'toolCall', id: 'edit-call', name: 'edit', arguments: { path: 'file.ts' } },
      ] } },
      skill({ id: 'agent-control', parentId: 'call', attribution: 'agent' }),
      { type: 'message', id: 'result', parentId: 'agent-control', message: { role: 'toolResult', toolCallId: 'edit-call', content: 'edited' } },
      answer('second-answer', 'result'),
      { type: 'message', id: 'normal-user', parentId: 'second-answer', message: { role: 'user', content: 'normal follow-up' } },
      answer('third-answer', 'normal-user'),
    ], 10));
    const history = await new GjcSessionsProvider().fetchHistory(APP_ID);
    assert.deepEqual(history.messages.map(({ turnId }) => turnId), [
      'skill', 'skill', 'resumed', 'resumed', 'resumed', 'normal-user', 'normal-user',
    ]);
    assert.ok(history.messages.every(({ turnStatus }) => turnStatus === 'completed'));
    const tool = history.messages.find(({ toolId }) => toolId === 'edit-call');
    assert.equal(tool?.turnId, 'resumed');
    assert.equal(tool?.toolResult?.content, 'edited');
    assert.equal(history.messages[2]?.content, '/skill:no-english second argument');
  });
});

test('a user skill injected into a running turn remains steering', async () => {
  await withFixture([
    { type: 'message', id: 'normal-user', parentId: 'config', message: { role: 'user', content: 'start work' } },
    answer('working', 'normal-user', 'toolUse'),
    { type: 'model_change', id: 'model', parentId: 'working' },
    skill({ parentId: 'model' }),
    answer('reply', 'skill'),
  ], async ({ provider }) => {
    const history = await provider.fetchHistory(APP_ID);
    assert.equal(history.messages[2]?.content, '/skill:no-english user argument');
    assert.ok(history.messages.every(({ turnId }) => turnId === 'normal-user'));
  });
});

test('session metadata derives from visible skill arguments and preserves an explicit user title', async () => {
  await withFixture([
    null, [], 123,
    skill({ id: 'hidden', display: false }),
    skill({ id: 'agent', attribution: 'agent', parentId: 'hidden' }),
    skill({ parentId: 'agent' }),
    answer('reply', 'skill'),
  ], async ({ synchronizer, filePath }) => {
    assert.equal(await synchronizer.synchronizeFile(filePath), APP_ID);
    assert.equal(sessionsDb.getSessionById(APP_ID)?.custom_name, 'User argument');
    assert.equal(sessionsDb.getSessionById(APP_ID)?.provider_session_id, PROVIDER_ID);
    sessionsDb.updateSessionCustomName(APP_ID, 'My skill session', 'user');
    await synchronizer.synchronizeFile(filePath);
    assert.equal(sessionsDb.getSessionById(APP_ID)?.custom_name, 'My skill session');
    const regenerated = await sessionsService.regenerateSessionTitle(APP_ID);
    assert.equal(regenerated.summary, 'User argument');
  });
});
