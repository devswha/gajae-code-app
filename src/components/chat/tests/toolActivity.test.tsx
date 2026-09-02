import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import i18n from '../../../i18n/config';
import type { ChatMessage } from '../types/types';
import {
  categorizeTool,
  currentTurnMessages,
  deriveLiveActivity,
  describeSubagent,
  describeToolSubject,
  formatLiveActivity,
  runningToolCalls,
} from '../utils/toolActivity';
import ActivityIndicator from '../view/ActivityIndicator';

/*
 * The activity line is a pure function of the transcript, so it is tested on
 * synthetic message sequences: what the composer shows is what these say.
 */

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 2, 0, 0, seconds));
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'chat', ...options }) as string;

const user = (content: string, seconds = 0): ChatMessage => ({ type: 'user', content, timestamp: at(seconds) });
const text = (content: string, seconds = 0): ChatMessage => ({ type: 'assistant', content, timestamp: at(seconds) });
const call = (toolName: string, toolInput: unknown, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant', content: '', timestamp: at(1), isToolUse: true, toolName, toolInput, toolId: `${toolName}-${Math.random()}`, ...overrides,
});
const done = (message: ChatMessage, isError = false): ChatMessage => ({ ...message, toolResult: { content: 'ok', isError } });

test('the subject of a call is what its card would title it', () => {
  assert.equal(describeToolSubject('read', { path: 'src/foo.ts' }), 'src/foo.ts');
  assert.equal(describeToolSubject('read', JSON.stringify({ path: 'src/foo.ts' })), 'src/foo.ts');
  assert.equal(describeToolSubject('search', { pattern: 'useSession', paths: ['src'] }), 'useSession');
  assert.equal(describeToolSubject('bash', { command: 'npm test\necho done' }), 'npm test');
  assert.equal(describeToolSubject('edit', { path: 'server/index.js', edits: [] }), 'server/index.js');
  assert.equal(describeToolSubject('write', { path: 'README.md', content: '' }), 'README.md');
  assert.equal(describeToolSubject('Read', { file_path: '/repo/a.ts' }), '/repo/a.ts');
  assert.equal(describeToolSubject('todo_write', { ops: [{ op: 'init', list: [{ items: ['a', 'b'] }] }] }), 'Task list, 2 tasks');
  // A string title ("Parameters") says nothing about this call; better empty.
  assert.equal(describeToolSubject('mystery_tool', { foo: 1 }), '');
  assert.equal(describeToolSubject('read', 'not json'), '');
});

test('a subagent is described by its label, batched tasks joined', () => {
  assert.equal(describeSubagent({ description: 'Survey the tests', subagent_type: 'explore' }), 'Survey the tests');
  assert.equal(describeSubagent({ agent: 'executor', tasks: [{ id: 'A', description: 'Fix lint' }, { id: 'B' }] }), 'Fix lint, B');
  assert.equal(describeSubagent({ agent: 'planner', tasks: [] }), 'planner');
  assert.equal(describeSubagent('nope'), '');
});

test('tool categories cover the runtime names and the Claude-shaped ones', () => {
  assert.equal(categorizeTool({ toolName: 'read' }), 'read');
  assert.equal(categorizeTool({ toolName: 'Read' }), 'read');
  assert.equal(categorizeTool({ toolName: 'find' }), 'search');
  assert.equal(categorizeTool({ toolName: 'Grep' }), 'search');
  assert.equal(categorizeTool({ toolName: 'bash' }), 'command');
  assert.equal(categorizeTool({ toolName: 'edit' }), 'edit');
  assert.equal(categorizeTool({ toolName: 'ApplyPatch' }), 'edit');
  assert.equal(categorizeTool({ toolName: 'write' }), 'write');
  assert.equal(categorizeTool({ toolName: 'web_search' }), 'web');
  assert.equal(categorizeTool({ toolName: 'task' }), 'subagent');
  assert.equal(categorizeTool({ toolName: 'Default', isSubagentContainer: true }), 'subagent');
  assert.equal(categorizeTool({ toolName: 'todo_write' }), 'other');
  assert.equal(categorizeTool({}), 'other');
});

test('only the current turn is read, and a call runs until its result lands', () => {
  const stale = call('bash', { command: 'sleep 999' }); // never answered in an earlier, aborted turn
  const running = call('read', { path: 'src/foo.ts' });
  const messages = [user('first'), stale, user('second'), done(call('search', { pattern: 'x' })), running];

  assert.deepEqual(currentTurnMessages(messages).map((message) => message.toolName), ['search', 'read']);
  assert.deepEqual(runningToolCalls(currentTurnMessages(messages)), [running]);
  // Without any user message the whole list is the turn.
  assert.equal(currentTurnMessages([running]).length, 1);
});

test('no tool in flight means the model is generating', () => {
  assert.deepEqual(deriveLiveActivity([]), { kind: 'thinking' });
  assert.deepEqual(deriveLiveActivity([user('go'), done(call('read', { path: 'a' })), text('Here is', 3)]), { kind: 'thinking' });
});

test('the running tool names itself and its subject', () => {
  const reading = deriveLiveActivity([user('go'), call('read', { path: 'src/foo.ts' })]);
  assert.deepEqual(reading, { kind: 'tool', category: 'read', toolName: 'read', subject: 'src/foo.ts', moreCount: 0 });
  assert.equal(formatLiveActivity(reading, t), 'Reading src/foo.ts');

  assert.equal(formatLiveActivity(deriveLiveActivity([call('bash', { command: 'npm test' })]), t), 'Running npm test');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('search', { pattern: 'useSession' })]), t), 'Searching "useSession"');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('edit', { path: 'server/index.js' })]), t), 'Editing server/index.js');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('write', { path: 'docs/a.md' })]), t), 'Writing docs/a.md');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('web_search', { query: 'react 19' })]), t), 'Searching the web for react 19');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('browser', { action: 'open', url: 'https://x.y' })]), t), 'Browsing open https://x.y');
  // A tool with no verb of its own keeps its card label; with no subject at all, just the label.
  assert.equal(formatLiveActivity(deriveLiveActivity([call('todo_write', { ops: [{ op: 'note', text: 'hi' }] })]), t), 'todo_write: note: hi');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('mystery', { a: 1 })]), t), 'Using mystery');
  // A read with no path falls back the same way rather than printing "Reading ".
  assert.equal(formatLiveActivity(deriveLiveActivity([call('read', {})]), t), 'Using Read');
});

test('parallel calls: the most recent speaks, the rest are a count', () => {
  const activity = deriveLiveActivity([
    user('go'),
    call('read', { path: 'a.ts' }),
    call('read', { path: 'b.ts' }),
    done(call('bash', { command: 'ls' })),
    call('search', { pattern: 'zap' }),
  ]);

  assert.equal(activity.kind, 'tool');
  assert.equal(activity.kind === 'tool' && activity.subject, 'zap');
  assert.equal(activity.kind === 'tool' && activity.moreCount, 2);
  assert.equal(formatLiveActivity(activity, t), 'Searching "zap" +2 more');
});

test('a subagent is reported by its description until the task completes', () => {
  const task = call('Task', { description: 'Survey the tests', subagent_type: 'explore' }, {
    isSubagentContainer: true,
    subagentState: { childTools: [], currentToolIndex: -1, isComplete: false },
  });
  assert.equal(formatLiveActivity(deriveLiveActivity([user('go'), task]), t), 'Subagent: Survey the tests');

  const finished = { ...task, subagentState: { childTools: [], currentToolIndex: -1, isComplete: true } };
  assert.deepEqual(deriveLiveActivity([user('go'), finished]), { kind: 'thinking' });

  // The runtime's own `task` tool, batched.
  const batch = call('task', { agent: 'executor', tasks: [{ id: 'Lint', description: 'Fix lint' }] });
  assert.equal(formatLiveActivity(deriveLiveActivity([batch]), t), 'Subagent: Fix lint');
  assert.equal(formatLiveActivity(deriveLiveActivity([call('task', {})]), t), 'Subagent running');
});

test('an open approval outranks the running tool, and a server status line outranks both', () => {
  const messages = [user('go'), call('bash', { command: 'rm -rf build' })];

  assert.deepEqual(deriveLiveActivity(messages, { awaitingInput: true }), { kind: 'awaiting_input' });
  assert.equal(formatLiveActivity({ kind: 'awaiting_input' }, t), 'Waiting for your approval');

  const status = deriveLiveActivity(messages, { awaitingInput: true, statusText: 'Compacting context...' });
  assert.deepEqual(status, { kind: 'status', text: 'Compacting context' });
  // Blank status text is no status at all.
  assert.equal(deriveLiveActivity(messages, { statusText: '   ' }).kind, 'tool');
});

test('the indicator shows the live activity and the elapsed time, with no decorative rotation', () => {
  const html = renderToStaticMarkup(createElement(ActivityIndicator, {
    activity: { statusText: null, canInterrupt: true, startedAt: Date.now(), awaitingInput: false },
    liveActivity: { kind: 'tool', category: 'read', toolName: 'read', subject: 'src/foo.ts', moreCount: 1 },
    onAbort: () => {},
  }));

  assert.match(html, /Reading src\/foo\.ts \+1 more…/);
  assert.match(html, /role="status"/);
  assert.match(html, /0s/);
  assert.match(html, /aria-label="Stop"/);
  assert.doesNotMatch(html, /Processing|Analyzing|Computing/);

  const idle = renderToStaticMarkup(createElement(ActivityIndicator, {
    activity: { statusText: null, canInterrupt: false, startedAt: Date.now(), awaitingInput: false },
    liveActivity: null,
  }));
  assert.match(idle, /Thinking…/);
  assert.doesNotMatch(idle, /aria-label="Stop"/);

  assert.equal(renderToStaticMarkup(createElement(ActivityIndicator, { activity: null })), '');
});
