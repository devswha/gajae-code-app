import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { lastTurnFiles } from './useLastTurnChanges';

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
    message({ toolName: 'edit', toolInput: JSON.stringify({ path: 'src/a.ts', edits: [{ old_text: 'before', new_text: 'after' }, { old_text: 'one', new_text: 'two' }] }) }),
    message({ toolName: 'write', toolInput: { path: 'src/b.ts', content: 'first\nsecond' } }),
    message({ toolName: 'delete', toolInput: { path: 'src/c.ts' } }),
    message({ toolName: 'move', toolInput: { from: 'src/old.ts', to: 'src/new.ts' } }),
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
  assert.deepEqual(files[1].rows?.map((row) => [row.kind, row.content]), [
    ['added', 'first'],
    ['added', 'second'],
  ]);
  assert.equal(files[2].rows, null);
  assert.equal(files[3].rows, null);
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
