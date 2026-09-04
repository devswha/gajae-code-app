import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { hasPendingLastTurnMutation, lastTurnFiles } from './useLastTurnChanges';

function message(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    provider: 'gjc',
    kind: 'tool_use',
    ...overrides,
  };
}

test('maps last-turn edit pairs, writes, deletes, and moves in call order', () => {
  const files = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Change files' }),
    message({ toolName: 'edit', toolInput: JSON.stringify({ path: 'src/a.ts', edits: [{ old_text: 'before', new_text: 'after' }, { old_text: 'one', new_text: 'two' }] }), toolResult: { content: 'ok', isError: false } }),
    message({ toolName: 'write', toolInput: { path: 'src/b.ts', content: 'first\nsecond' }, toolResult: { content: 'ok', isError: false } }),
    message({ toolName: 'delete', toolInput: { path: 'src/c.ts' }, toolResult: { content: 'ok', isError: false } }),
    message({ toolName: 'move', toolInput: { from: 'src/old.ts', to: 'src/new.ts' }, toolResult: { content: 'ok', isError: false } }),
  ]);

  assert.deepEqual(files.map((file) => [file.path, file.kind, file.oldPath]), [
    ['src/a.ts', 'edit', null],
    ['src/b.ts', 'write', null],
    ['src/c.ts', 'delete', null],
    ['src/new.ts', 'move', 'src/old.ts'],
  ]);
  assert.deepEqual(files[0].rows?.map((row) => [row.kind, row.content]), [
    ['removed', 'before'],
    ['added', 'after'],
    ['context', ''],
    ['removed', 'one'],
    ['added', 'two'],
  ]);
  assert.deepEqual(files[1].rows?.map((row) => [row.kind, row.content, row.kind === 'hunk' ? null : row.newLine]), [
    ['added', 'first', 1],
    ['added', 'second', 2],
  ]);
  assert.equal(files[2].rows, null);
  assert.equal(files[3].rows, null);
});

test('a written file that ends in a newline shows no phantom empty last line', () => {
  const files = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Write' }),
    message({ toolName: 'write', toolInput: { path: 'note.md', content: 'hello\n' }, toolResult: { content: 'ok', isError: false } }),
    message({ toolName: 'write', toolInput: { path: 'blank.md', content: '\n' }, toolResult: { content: 'ok', isError: false } }),
    message({ toolName: 'write', toolInput: { path: 'gap.md', content: 'a\n\n' }, toolResult: { content: 'ok', isError: false } }),
  ]);
  assert.deepEqual(files.map((file) => file.rows?.map((row) => row.content)), [['hello'], [''], ['a', '']]);
});

test('excludes edits before the last user message and ignores a turn without edits', () => {
  const files = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'First request' }),
    message({ toolName: 'write', toolInput: { path: 'old.ts', content: 'old' } }),
    message({ kind: 'text', role: 'user', content: 'Second request' }),
    message({ toolName: 'read', toolInput: { path: 'old.ts' } }),
  ]);

  assert.deepEqual(files, []);
});

test('includes only mutation calls with a successful result', () => {
  const messages = [
    message({ kind: 'text', role: 'user', content: 'Change files' }),
    message({ toolName: 'write', toolInput: { path: 'pending.ts', content: 'pending' } }),
    message({ toolName: 'edit', toolInput: { path: 'failed.ts', edits: [] }, toolResult: { content: 'not found', isError: true } }),
    message({ toolName: 'write', toolId: 'streaming', toolInput: { path: 'streaming.ts', content: 'partial' } }),
    message({ kind: 'tool_result', toolId: 'streaming', content: 'partial', isError: false, isFinal: false }),
    message({ toolName: 'write', toolId: 'successful', toolInput: { path: 'done.ts', content: 'done' } }),
    message({ kind: 'tool_result', toolId: 'successful', content: 'ok', isError: false, isFinal: true }),
  ];
  const files = lastTurnFiles(messages);

  assert.deepEqual(files.map((file) => file.path), ['done.ts']);
  assert.equal(hasPendingLastTurnMutation(messages), true);
});

test('omits quadratic edit previews above the bounded diff budget', () => {
  const content = Array.from({ length: 600 }, (_, index) => `line ${index}`).join('\n');
  const [file] = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Replace it' }),
    message({
      toolName: 'edit',
      toolInput: { path: 'large.ts', edits: [{ old_text: content, new_text: content.split('line').join('row') }] },
      toolResult: { content: 'ok', isError: false },
    }),
  ]);

  assert.equal(file.rows, null);
  assert.equal(file.tooLarge, true);
});

test('shares the diff budget across every replacement in one turn', () => {
  const before = Array.from({ length: 400 }, (_, index) => `before ${index}`).join('\n');
  const after = Array.from({ length: 400 }, (_, index) => `after ${index}`).join('\n');
  const [file] = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Replace both' }),
    message({
      toolName: 'edit',
      toolInput: {
        path: 'aggregate.ts',
        edits: [
          { old_text: before, new_text: after },
          { old_text: before, new_text: after },
        ],
      },
      toolResult: { content: 'ok', isError: false },
    }),
  ]);

  assert.equal(file.rows, null);
  assert.equal(file.tooLarge, true);
});

test('charges separator rows to the shared output-row budget', () => {
  const edits = Array.from({ length: 700 }, () => ({ old_text: 'before', new_text: 'after' }));
  const [file] = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Replace many fragments' }),
    message({
      toolName: 'edit',
      toolInput: { path: 'many.ts', edits },
      toolResult: { content: 'ok', isError: false },
    }),
  ]);

  assert.equal(file.rows, null);
  assert.equal(file.tooLarge, true);
});

/*
 * The runtime's result details are the source of truth for every edit mode.
 * A replace-mode call gets real line numbers from them; an apply_patch
 * envelope (GPT-5 family), whose input names no path, gets its files from
 * them; a result without details falls back to the replace-mode input.
 */
test('an edit with runtime details takes its rows, with line numbers, from the result', () => {
  const [file] = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Edit' }),
    message({
      toolName: 'edit',
      toolInput: { path: 'src/a.ts', edits: [{ old_text: 'x = 1', new_text: 'x = 2' }] },
      toolResult: { content: 'ok', isError: false, toolUseResult: { path: '/repo/src/a.ts', diff: ' 4|before\n-5|x = 1\n+5|x = 2\n 6|after', firstChangedLine: 5 } },
    }),
  ]);
  assert.deepEqual([file.path, file.kind, file.oldPath, file.tooLarge], ['/repo/src/a.ts', 'edit', null, false]);
  assert.deepEqual(file.rows?.map((row) => [row.kind, row.content, row.kind === 'hunk' ? null : row.oldLine, row.kind === 'hunk' ? null : row.newLine]), [
    ['context', 'before', 4, 4],
    ['removed', 'x = 1', 5, null],
    ['added', 'x = 2', null, 5],
    ['context', 'after', 6, 6],
  ]);
});

test('an apply_patch envelope lists every file its result reports, by operation', () => {
  const files = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Patch' }),
    message({
      toolName: 'apply_patch',
      toolId: 'patch-1',
      toolInput: { input: '*** Begin Patch\n*** Add File: new.ts\n+hello\n*** End Patch' },
    }),
    message({
      kind: 'tool_result',
      toolId: 'patch-1',
      content: 'ok',
      isError: false,
      isFinal: true,
      ...({ toolUseResult: { diff: '+1|hello', perFileResults: [
        { path: 'new.ts', diff: '+1|hello', op: 'create' },
        { path: 'old.ts', diff: '-3|gone', op: 'update' },
        { path: 'from.ts', diff: '', op: 'update', move: 'to.ts' },
        { path: 'dead.ts', diff: '', op: 'delete' },
        { path: 'broken.ts', diff: '', isError: true, errorText: 'context not found' },
      ] } } as object),
    }),
  ]);
  assert.deepEqual(files.map((file) => [file.path, file.kind, file.oldPath, file.rows?.length ?? null]), [
    ['new.ts', 'write', null, 1],
    ['old.ts', 'edit', null, 1],
    ['to.ts', 'move', 'from.ts', null],
    ['dead.ts', 'delete', null, null],
  ]);
  assert.deepEqual(files[0].rows, [{ kind: 'added', content: 'hello', oldLine: null, newLine: 1 }]);
});

test('an apply_patch call is a pending mutation until its result lands, and nothing without details', () => {
  const pending = [
    message({ kind: 'text', role: 'user', content: 'Patch' }),
    message({ toolName: 'apply_patch', toolId: 'patch-2', toolInput: { input: '*** Begin Patch\n*** End Patch' } }),
  ];
  assert.equal(hasPendingLastTurnMutation(pending), true);
  assert.deepEqual(lastTurnFiles([...pending, message({ kind: 'tool_result', toolId: 'patch-2', content: 'ok', isError: false, isFinal: true })]), []);
});

test('a result diff above the budget marks the file too large instead of rendering it', () => {
  const diff = Array.from({ length: 2500 }, (_, index) => `+${index + 1}|line`).join('\n');
  const [file] = lastTurnFiles([
    message({ kind: 'text', role: 'user', content: 'Big' }),
    message({ toolName: 'edit', toolInput: { path: 'big.ts', edits: [] }, toolResult: { content: 'ok', isError: false, toolUseResult: { path: 'big.ts', diff } } }),
  ]);
  assert.deepEqual([file.rows, file.tooLarge], [null, true]);
});
