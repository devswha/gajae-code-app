import { useCallback, useMemo, useState } from 'react';

import { createCachedDiffCalculator } from '../../chat/utils/messageTransforms';
import type { NormalizedMessage } from '../../../stores/useSessionStore';
import { useSessionStore } from '../../../stores/useSessionStore';
import type { UnifiedDiffRow } from '../utils/unifiedDiff';

export type LastTurnFile = {
  path: string;
  kind: 'edit' | 'write' | 'delete' | 'move';
  oldPath: string | null;
  rows: UnifiedDiffRow[] | null;
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

function editRows(edits: unknown): UnifiedDiffRow[] {
  if (!Array.isArray(edits)) return [];
  const rows: UnifiedDiffRow[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') continue;
    const { old_text: oldText, new_text: newText } = edit as { old_text?: unknown; new_text?: unknown };
    const pairRows = diff(String(oldText ?? ''), String(newText ?? '')).map((line) => ({
      kind: line.type,
      content: line.content,
      oldLine: null,
      newLine: null,
    }));
    if (rows.length > 0 && pairRows.length > 0) {
      rows.push({ kind: 'context', content: '', oldLine: null, newLine: null });
    }
    rows.push(...pairRows);
  }
  return rows;
}

export function lastTurnFiles(messages: NormalizedMessage[]): LastTurnFile[] {
  const lastUser = messages.reduce((last, message, index) =>
    message.kind === 'text' && message.role === 'user' ? index : last, -1);

  return messages.slice(lastUser + 1).flatMap((message): LastTurnFile[] => {
    if (message.kind !== 'tool_use' || !message.toolName) return [];
    const kind = message.toolName.toLowerCase();
    if (kind !== 'edit' && kind !== 'write' && kind !== 'delete' && kind !== 'move') return [];

    const input = parseToolInput(message.toolInput);
    if (!input) return [];

    if (kind === 'move') {
      const oldPath = pathValue(input.from) ?? pathValue(input.path);
      const path = pathValue(input.to) ?? pathValue(input.new_path);
      return oldPath && path ? [{ path, kind, oldPath, rows: null }] : [];
    }

    const path = pathValue(input.path);
    if (!path) return [];
    if (kind === 'edit') return [{ path, kind, oldPath: null, rows: editRows(input.edits) }];
    if (kind === 'write') {
      const content = typeof input.content === 'string' ? input.content : '';
      return [{ path, kind, oldPath: null, rows: content.split('\n').map((line) => ({
        kind: 'added',
        content: line,
        oldLine: null,
        newLine: null,
      })) }];
    }
    return [{ path, kind, oldPath: null, rows: null }];
  });
}

export function useLastTurnChanges(sessionId: string | undefined, enabled: boolean) {
  const { getMessages } = useSessionStore();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const messages = sessionId ? getMessages(sessionId) : EMPTY_MESSAGES;
  const snapshot = useMemo(() => ({ messages, refreshVersion }), [messages, refreshVersion]);
  const files = useMemo(
    () => enabled && sessionId ? lastTurnFiles(snapshot.messages) : [],
    [enabled, sessionId, snapshot],
  );
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  return { files, refresh };
}
