import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../../../i18n/config';
import enChat from '../../../i18n/locales/en/chat.json';
import type { ChatMessage } from '../types/types';
import {
  DEFAULT_TOOL_OUTPUT_DENSITY,
  TOOL_OUTPUT_DENSITIES,
  collapsibleStartsOpen,
  cyclesToolOutputDensity,
  isToolOutputDensity,
  nextToolOutputDensity,
  toolOutputDensityRules,
} from '../utils/toolOutputDensity';
import type { ToolOutputDensity } from '../utils/toolOutputDensity';
import MessageComponent from '../view/MessageComponent';
import ToolGroupContainer from '../view/ToolGroupContainer';

/*
 * The three levels are a table, and this file is that table written as
 * assertions: what each renderer shows before anyone clicks, at each level.
 * Static markup is enough because every renderer now decides its first paint
 * from the level rather than in an effect.
 */

type DiffLine = { type: string; content: string; lineNum: number };
const lineDiff = (oldStr: string, newStr: string): DiffLine[] => [
  ...oldStr.split('\n').filter(Boolean).map((content, index) => ({ type: 'removed', content, lineNum: index + 1 })),
  ...newStr.split('\n').filter(Boolean).map((content, index) => ({ type: 'added', content, lineNum: index + 1 })),
];

const at = new Date('2026-09-02T00:00:00Z');

const render = (message: ChatMessage, density: ToolOutputDensity): string => renderToStaticMarkup(createElement(MessageComponent, {
  message,
  prevMessage: null,
  createDiff: lineDiff,
  provider: 'gjc',
  density,
}));

const shell = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: at,
  isToolUse: true,
  toolName: 'bash',
  toolInput: { command: 'npm test' },
  toolId: 'tool-shell',
  toolResult: { content: 'one\ntwo\nthree', isError: false },
  ...overrides,
});

const edit = (): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: at,
  isToolUse: true,
  toolName: 'edit',
  toolInput: JSON.stringify({ path: 'src/app.ts', edits: [{ old_text: 'const a = 1;', new_text: 'const a = 2;\nconst b = 3;' }] }),
  toolId: 'tool-edit',
  toolResult: { content: 'ok', isError: false },
});

const thought = (): ChatMessage => ({
  type: 'assistant',
  content: 'Weighing the two approaches carefully',
  timestamp: at,
  isThinking: true,
});

const subagent = (isError = false): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: at,
  isToolUse: true,
  isSubagentContainer: true,
  toolName: 'Task',
  toolInput: { description: 'Survey the tests', subagent_type: 'explore', prompt: 'Look around' },
  toolId: 'tool-task',
  toolResult: { content: 'Found three suites', isError },
  subagentState: {
    isComplete: true,
    currentToolIndex: 1,
    childTools: [
      { toolId: 'c1', toolName: 'Read', toolInput: { file_path: 'a.ts' }, timestamp: at },
      { toolId: 'c2', toolName: 'Grep', toolInput: { pattern: 'test(' }, timestamp: at },
    ],
  },
});

test('the level table: what each level folds and what it opens', () => {
  const compact = toolOutputDensityRules('compact');
  const balanced = toolOutputDensityRules('balanced');
  const detailed = toolOutputDensityRules('detailed');

  assert.deepEqual([compact.groupThreshold, balanced.groupThreshold, detailed.groupThreshold], [1, 2, Number.POSITIVE_INFINITY]);
  assert.deepEqual([compact.bashOutputOpen, balanced.bashOutputOpen, detailed.bashOutputOpen], [false, false, true]);
  // A failure unfolds itself at balanced and detailed; compact marks the row
  // and keeps the body folded, or a failing session would not be compact at all.
  assert.deepEqual([compact.failureOpens, balanced.failureOpens, detailed.failureOpens], [false, true, true]);
  assert.deepEqual([compact.diffOpen, balanced.diffOpen, detailed.diffOpen], [false, true, true]);
  assert.deepEqual([compact.showReasoning, balanced.showReasoning, detailed.showReasoning], [false, false, true]);
  assert.deepEqual([compact.showRawParameters, balanced.showRawParameters, detailed.showRawParameters], [false, false, true]);
  assert.deepEqual([compact.subagentOpen, balanced.subagentOpen, detailed.subagentOpen], [false, false, true]);
  // A turn's tool calls fold into one work block at the two folding levels;
  // detailed shows the cards at the top level as before.
  assert.deepEqual([compact.workBlock, balanced.workBlock, detailed.workBlock], [true, true, false]);
  // Balanced defers to each tool's own default for the remaining cards; the
  // outer levels override it in their direction.
  assert.equal(collapsibleStartsOpen(balanced, true), true);
  assert.equal(collapsibleStartsOpen(balanced, false), false);
  assert.equal(collapsibleStartsOpen(compact, true), false);
  assert.equal(collapsibleStartsOpen(detailed, false), true);
  // An unknown level reads as the default rather than as nothing.
  assert.deepEqual(toolOutputDensityRules(undefined), toolOutputDensityRules(DEFAULT_TOOL_OUTPUT_DENSITY));
  assert.equal(DEFAULT_TOOL_OUTPUT_DENSITY, 'balanced');
});

test('the quick toggle cycles through every level and back', () => {
  assert.equal(nextToolOutputDensity('compact'), 'balanced');
  assert.equal(nextToolOutputDensity('balanced'), 'detailed');
  assert.equal(nextToolOutputDensity('detailed'), 'compact');
  assert.equal(TOOL_OUTPUT_DENSITIES.length, 3);
  assert.equal(isToolOutputDensity('detailed'), true);
  assert.equal(isToolOutputDensity('verbose'), false);
  assert.equal(isToolOutputDensity(true), false);
});

test('the shortcut is Cmd/Ctrl+Shift+D and nothing looser', () => {
  const chord = { key: 'd', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false };

  assert.equal(cyclesToolOutputDensity({ ...chord, metaKey: true, shiftKey: true, key: 'D' }), true);
  assert.equal(cyclesToolOutputDensity({ ...chord, ctrlKey: true, shiftKey: true }), true);
  // Plain Cmd+D is the browser's bookmark key; leave it alone.
  assert.equal(cyclesToolOutputDensity({ ...chord, metaKey: true }), false);
  assert.equal(cyclesToolOutputDensity({ ...chord, shiftKey: true }), false);
  assert.equal(cyclesToolOutputDensity({ ...chord, metaKey: true, shiftKey: true, altKey: true }), false);
  // Holding the key must not spin through all three levels.
  assert.equal(cyclesToolOutputDensity({ ...chord, metaKey: true, shiftKey: true, repeat: true }), false);
});

test('shell output: folded at compact and balanced, open at detailed', () => {
  const compact = render(shell(), 'compact');
  const balanced = render(shell(), 'balanced');
  const detailed = render(shell(), 'detailed');

  for (const folded of [compact, balanced]) {
    assert.match(folded, /3 lines/);
    assert.doesNotMatch(folded, /<pre/);
  }
  assert.doesNotMatch(detailed, /3 lines/);
  assert.match(detailed, /<pre[^>]*>one\ntwo\nthree<\/pre>/);
  assert.match(detailed, />Output</);
});

test('a failed shell command opens at balanced and detailed; compact marks the row and stays folded', () => {
  const failed = shell({ toolResult: { content: 'exit 1: missing module', isError: true } });
  for (const density of ['balanced', 'detailed'] as const) {
    const html = render(failed, density);
    assert.match(html, /<pre[^>]*text-destructive[^>]*>exit 1: missing module<\/pre>/, density);
  }

  const compact = render(failed, 'compact');
  assert.doesNotMatch(compact, /<pre/);
  assert.match(compact, /aria-expanded="false"/);
  // The closed row still says it failed: the error badge, not just a colour.
  assert.match(compact, /text-destructive[^>]*>.*sr-only">Error</);
  assert.match(compact, /1 line/);
});

test('an edit: compact keeps the file and its +N/−M, the other levels open the diff', () => {
  const compact = render(edit(), 'compact');
  const balanced = render(edit(), 'balanced');
  const detailed = render(edit(), 'detailed');

  assert.match(compact, /data-state="closed"/);
  assert.match(compact, /app\.ts/);
  assert.match(compact, /data-testid="diff-stats"[^>]*>.*\+2.*−1/);
  assert.doesNotMatch(compact, /bg-diff-added/);

  for (const open of [balanced, detailed]) {
    assert.match(open, /group\/section[^"]*"[^>]*data-state="open"|data-state="open"[^>]*group\/section/);
    assert.match(open, /bg-diff-added/);
    assert.match(open, /const b = 3;/);
  }
});

test('reasoning is hidden below detailed and open at detailed', () => {
  assert.equal(render(thought(), 'compact'), '');
  assert.equal(render(thought(), 'balanced'), '');

  const detailed = render(thought(), 'detailed');
  assert.match(detailed, /Weighing the two approaches carefully/);
  assert.match(detailed, /aria-expanded="true"/);
});

test('raw parameters appear only at detailed, and folded', () => {
  const message: ChatMessage = {
    type: 'assistant',
    content: '',
    timestamp: at,
    isToolUse: true,
    toolName: 'todo_write',
    toolInput: JSON.stringify({ ops: [{ op: 'add', text: 'ship it' }] }),
    toolId: 'tool-todo',
    toolResult: { content: 'ok', isError: false },
  };

  assert.doesNotMatch(render(message, 'compact'), /raw params/);
  assert.doesNotMatch(render(message, 'balanced'), /raw params/);
  const detailed = render(message, 'detailed');
  assert.match(detailed, /raw params/);
  // The card itself is open at detailed, the raw-params disclosure inside is not.
  assert.match(detailed, /ship it/);
  assert.doesNotMatch(detailed, /&quot;op&quot;:\s*&quot;add&quot;/);
});

test('a subagent: compact is one row with its outcome, detailed unfolds the history', () => {
  const compact = render(subagent(), 'compact');
  const balanced = render(subagent(), 'balanced');
  const detailed = render(subagent(), 'detailed');

  assert.match(compact, /Survey the tests/);
  assert.match(compact, /Completed \(2 tools\)/);
  assert.doesNotMatch(compact, /View tool history/);
  assert.doesNotMatch(compact, /Look around/);

  assert.match(balanced, /data-state="closed"/);
  assert.doesNotMatch(balanced, /View tool history/); // folded, so the body is not rendered

  assert.match(detailed, /View tool history/);
  assert.match(detailed, /Look around/);
  assert.match(detailed, /Grep/);
  assert.match(detailed, /test\(/);
});

test('a failed subagent says so at every level, and opens at balanced and detailed', () => {
  for (const density of TOOL_OUTPUT_DENSITIES) {
    assert.match(render(subagent(true), density), /Failed \(2 tools\)/, density);
  }
  for (const density of ['balanced', 'detailed'] as const) {
    const html = render(subagent(true), density);
    assert.match(html, /Found three suites/, density);
    assert.match(html, /aria-expanded="true"/, density);
  }

  // Compact: the outcome sits in the folded row itself; the task card does not
  // unfold. (The failure's own result text still renders below it, as it does
  // for every failed tool that is not folded into its call.)
  const compact = render(subagent(true), 'compact');
  assert.match(compact, /group\/section[^"]*"[^>]*data-state="closed"|data-state="closed"[^>]*group\/section/);
  assert.match(compact, /aria-expanded="false"/);
  assert.doesNotMatch(compact, /aria-expanded="true"/);
});

const renderGroup = (messages: ChatMessage[], density: ToolOutputDensity) => renderToStaticMarkup(createElement(ToolGroupContainer, {
  group: { _isGroup: true, toolName: 'bash', messages, timestamp: at },
  prevMessage: null,
  createDiff: lineDiff,
  getMessageKey: (message) => String(message.toolId),
  provider: 'gjc',
  density,
}));

test('a folded group opens itself when one of its calls failed, and says so', () => {
  const ok = shell({ toolId: 'a' });
  const failed = shell({ toolId: 'b', toolResult: { content: 'exit 1', isError: true } });

  const quiet = renderGroup([ok, shell({ toolId: 'c' })], 'balanced');
  assert.match(quiet, /aria-expanded="false"/);
  assert.match(quiet, /×2/);
  assert.doesNotMatch(quiet, new RegExp(enChat.tools.error));

  const loud = renderGroup([ok, failed], 'balanced');
  assert.match(loud, /aria-expanded="true"/);
  assert.ok(loud.includes(enChat.tools.error));
  assert.match(loud, /exit 1/);
});

test('at compact a failed group keeps its error label but stays folded', () => {
  // Compact wraps even a lone call in a group, so this is what every failed
  // command looks like there: one row, marked, closed. Before the rule
  // existed, a session of failing commands rendered wider at compact than at
  // balanced.
  const failed = shell({ toolId: 'b', toolResult: { content: 'exit 1: missing module', isError: true } });

  const lone = renderGroup([failed], 'compact');
  assert.ok(lone.includes(enChat.tools.error));
  assert.match(lone, /aria-expanded="false"/);
  assert.doesNotMatch(lone, /aria-expanded="true"/);
  assert.doesNotMatch(lone, /exit 1: missing module/);

  const run = renderGroup([shell({ toolId: 'a' }), failed, shell({ toolId: 'c' })], 'compact');
  assert.ok(run.includes(enChat.tools.error));
  assert.match(run, /×3/);
  assert.match(run, /aria-expanded="false"/);
  assert.doesNotMatch(run, /exit 1: missing module/);
});

test('a group of one, as compact makes them, carries no count', () => {
  const html = renderToStaticMarkup(createElement(ToolGroupContainer, {
    group: { _isGroup: true, toolName: 'bash', messages: [shell()], timestamp: at },
    prevMessage: null,
    createDiff: lineDiff,
    getMessageKey: (message) => String(message.toolId),
    provider: 'gjc',
    density: 'compact',
  }));

  assert.doesNotMatch(html, /×1/);
  assert.match(html, /npm test/);
  assert.match(html, /aria-expanded="false"/);
});
