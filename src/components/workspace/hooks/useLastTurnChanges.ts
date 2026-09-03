import { useCallback, useMemo, useState } from 'react';

import { createCachedDiffCalculator } from '../../chat/utils/messageTransforms';
import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { UnifiedDiffRow } from '../utils/unifiedDiff';

export type LastTurnFile = {
  path: string;
  kind: 'edit' | 'write' | 'delete' | 'move';
  oldPath: string | null;
  rows: UnifiedDiffRow[] | null;
  tooLarge: boolean;
};

type ToolInput = {
  path?: unknown;
  content?: unknown;
  edits?: unknown;
  from?: unknown;
  to?: unknown;
  new_path?: unknown;
};

const diff = createCachedDiffCalculator();
const EMPTY_MESSAGES: NormalizedMessage[] = [];

function parseToolInput(input: unknown): ToolInput | null {
  if (typeof input === 'string') {
    try {
      return parseToolInput(JSON.parse(input));
    } catch {
      return null;
    }
  }
  return input && typeof input === 'object' && !Array.isArray(input) ? input as ToolInput : null;
}

function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isMutationTool(message: NormalizedMessage): boolean {
  if (message.kind !== 'tool_use' || !message.toolName) return false;
  return ['edit', 'write', 'delete', 'move'].includes(message.toolName.toLowerCase());
}

export function hasPendingLastTurnMutation(messages: NormalizedMessage[]): boolean {
  const lastUser = messages.reduce((last, message, index) =>
    message.kind === 'text' && message.role === 'user' ? index : last, -1);
  const turn = messages.slice(lastUser + 1);
  const results = new Map(turn
    .filter((message) => message.kind === 'tool_result' && message.toolId)
    .map((message) => [message.toolId!, message]));
  return turn.some((message) => {
    if (!isMutationTool(message)) return false;
    const result = message.toolResult ?? (message.toolId ? results.get(message.toolId) : null);
    return !result || ('isFinal' in result && result.isFinal === false);
  });
}

const MAX_DIFF_CHARACTERS = 200000;
const MAX_DIFF_CELLS = 250000;
const MAX_DIFF_ROWS = 2000;

type DiffBudget = { characters: number; cells: number; rows: number };

function editRows(edits: unknown, budget: DiffBudget): UnifiedDiffRow[] | null {
  if (!Array.isArray(edits)) return [];
  const rows: UnifiedDiffRow[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') continue;
    const { old_text: oldText, new_text: newText } = edit as { old_text?: unknown; new_text?: unknown };
    const oldValue = String(oldText ?? '');
    const newValue = String(newText ?? '');
    const oldLines = oldValue.split('\n').length;
    const newLines = newValue.split('\n').length;
    const characters = oldValue.length + newValue.length;
    const cells = oldLines * newLines;
    if (characters > budget.characters || cells > budget.cells) {
      return null;
    }
    budget.characters -= characters;
    budget.cells -= cells;
    const pairRows = diff(oldValue, newValue).map((line) => ({
      kind: line.type,
      content: line.content,
      oldLine: null,
      newLine: null,
    }));
    const separatorRows = rows.length > 0 && pairRows.length > 0 ? 1 : 0;
    if (pairRows.length + separatorRows > budget.rows) return null;
    budget.rows -= pairRows.length + separatorRows;
    if (separatorRows > 0) {
      rows.push({ kind: 'context', content: '', oldLine: null, newLine: null });
    }
    rows.push(...pairRows);
  }
  return rows;
}

export function lastTurnFiles(messages: NormalizedMessage[]): LastTurnFile[] {
  const lastUser = messages.reduce((last, message, index) =>
    message.kind === 'text' && message.role === 'user' ? index : last, -1);

  const turn = messages.slice(lastUser + 1);
  const budget: DiffBudget = {
    characters: MAX_DIFF_CHARACTERS,
    cells: MAX_DIFF_CELLS,
    rows: MAX_DIFF_ROWS,
  };
  const results = new Map<string, NormalizedMessage>();
  for (const message of turn) {
    if (message.kind === 'tool_result' && message.toolId) results.set(message.toolId, message);
  }

  return turn.flatMap((message): LastTurnFile[] => {
    if (message.kind !== 'tool_use' || !message.toolName) return [];
    const kind = message.toolName.toLowerCase();
    if (kind !== 'edit' && kind !== 'write' && kind !== 'delete' && kind !== 'move') return [];

    const input = parseToolInput(message.toolInput);
    if (!input) return [];
    const result = message.toolResult ?? (message.toolId ? results.get(message.toolId) : null);
    if (!result || result.isError === true || ('isFinal' in result && result.isFinal === false)) return [];

    if (kind === 'move') {
      const oldPath = pathValue(input.from) ?? pathValue(input.path);
      const path = pathValue(input.to) ?? pathValue(input.new_path);
      return oldPath && path ? [{ path, kind, oldPath, rows: null, tooLarge: false }] : [];
    }

    const path = pathValue(input.path);
    if (!path) return [];
    if (kind === 'edit') {
      const rows = editRows(input.edits, budget);
      return [{ path, kind, oldPath: null, rows, tooLarge: rows === null }];
    }
    if (kind === 'write') {
      const content = typeof input.content === 'string' ? input.content : '';
      const lines = content.split('\n');
      // A file that ends in a newline has no extra empty last line, as git
      // would agree; the split alone would show one.
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      if (content.length > budget.characters || lines.length > budget.rows) {
        return [{ path, kind, oldPath: null, rows: null, tooLarge: true }];
      }
      budget.characters -= content.length;
      budget.rows -= lines.length;
      // The whole file is new, so every row has a real line in the file: a
      // comment on it lands as `path:line`, same as a working-tree diff.
      return [{ path, kind, oldPath: null, rows: lines.map((line, index) => ({
        kind: 'added',
        content: line,
        oldLine: null,
        newLine: index + 1,
      })), tooLarge: false }];
    }
    return [{ path, kind, oldPath: null, rows: null, tooLarge: false }];
  });
}

export function useLastTurnChanges(sessionStore: SessionStore, sessionId: string | undefined, enabled: boolean) {
  const { getMessages, getSessionSlot } = sessionStore;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const messages = sessionId ? getMessages(sessionId) : EMPTY_MESSAGES;
  const snapshot = useMemo(() => ({ messages, refreshVersion }), [messages, refreshVersion]);
  const files = useMemo(
    () => enabled && sessionId ? lastTurnFiles(snapshot.messages) : [],
    [enabled, sessionId, snapshot],
  );
  const pending = useMemo(
    () => enabled && sessionId ? hasPendingLastTurnMutation(snapshot.messages) : false,
    [enabled, sessionId, snapshot],
  );
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  const status = sessionId ? getSessionSlot(sessionId)?.status ?? 'loading' : 'idle';
  return { files, pending, refresh, status };
}
