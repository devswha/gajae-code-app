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
