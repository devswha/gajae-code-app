import type { ChatMessage } from '../types/types';

import { categorizeTool } from './toolActivity';
import type { ToolCategory } from './toolActivity';
import { groupConsecutiveTools, hasFailedResult } from './toolGrouping';
import type { MessageListItem } from './toolGrouping';
import { toolOutputDensityRules } from './toolOutputDensity';
import type { ToolOutputDensity } from './toolOutputDensity';

/**
 * A turn's work, folded.
 *
 * Between a user message and the answer, an agent reads, searches, runs and
 * edits - often dozens of times. Each call already renders as a row or a
 * same-tool group, but a reader scanning the conversation wants the answer,
 * and the scaffolding above it one row high: Codex's "Worked for 42s",
 * Cursor's compact chat. This module decides which messages that row covers
 * and what its summary says; `TurnWorkBlock` renders it.
 *
 * A turn is read as prose and work, alternating: every maximal run of
 * consecutive tool calls folds into one block, and the prose the model writes
 * between those runs - "Found it, now checking the tests." - stays outside,
 * in order, exactly where it was said. So a turn reads `Let me look.` /
 * `Worked for 12s · 3 files read` / `Found the bug, fixing.` / `Worked for
 * 5s · 2 edits` / `All green.` - the way Codex and Cursor lay a turn out. What
 * the model says is never hidden behind a fold, whether it turns out to be
 * narration or the answer, and a live run reads as a conversation rather
 * than a status line that finally yields one paragraph.
 *
 * Reasoning is left out of the block: it follows the density rules on its own
 * (hidden below detailed, and detailed has no block), so a thought between two
 * calls is hoisted ahead of the block rather than counted as work, and does
 * not split the run.
 *
 * A live turn has a block from its first moment, not its first tool call: an
 * empty one at the end of the turn that reads `Thinking…` until a call
 * arrives, when the block takes the same place with that call inside. The
 * same empty block follows prose the model wrote while the run is still going,
 * because the run has not said what comes next. A turn that ends on prose
 * ends without that block - the answer stands alone - which is why the empty
 * block exists only while `running`.
 */

export interface TurnWorkBlockItem {
  _isWorkBlock: true;
  /** One run of consecutive tool calls, in order; reasoning excluded. Empty while a live turn has nothing in flight yet. */
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
  /** When this block's work began: the prose just before it, or the user message that began the turn, if in the window. */
  startedAt: ChatMessage['timestamp'] | null;
  /** When the first message after the block's last call arrived, if any. */
  endedAt: ChatMessage['timestamp'] | null;
  /** The transcript's last block: a live run, if there is one, is working on it. */
  isTail: boolean;
}

export type TurnListItem = ChatMessage | TurnWorkBlockItem;

export function isTurnWorkBlockItem(item: PaneListItem): item is TurnWorkBlockItem {
  return Reflect.has(item, '_isWorkBlock') && (item as TurnWorkBlockItem)._isWorkBlock === true;
}

const startsTurn = (message: ChatMessage): boolean => message.type === 'user' && !message.isSystemNotice;
const isToolCall = (message: ChatMessage): boolean => Boolean(message.isToolUse);

export interface FoldOptions {
  /** A run is in flight for the last turn: it gets a block even before its first tool call. */
  running?: boolean;
}

/** The live turn's block before any call: nothing inside, so nothing to open. */
export const isPendingWorkBlock = (block: TurnWorkBlockItem): boolean => block.messages.length === 0;

const isProse = (message: ChatMessage): boolean => !isToolCall(message) && !message.isThinking;

/**
 * Emits one turn: prose as it is, each run of calls as a block. A run is cut
 * by prose only; a thought inside it is hoisted ahead of the block. While
 * `running`, the last turn ends on a block - an empty one after prose (or
 * nothing at all), so the run's status has a row until it says more.
 */
function foldTurn(turn: ChatMessage[], turnStartedAt: ChatMessage['timestamp'] | null, isLastTurn: boolean, running: boolean, out: TurnListItem[]): void {
  let startedAt = turnStartedAt;
  let lastBlock: TurnWorkBlockItem | null = null;
  // Prose after the last block: the run has not said what comes next.
  let openEnded = true;
  let index = 0;
  while (index < turn.length) {
    if (isProse(turn[index])) {
      out.push(turn[index]);
      startedAt = turn[index].timestamp;
      openEnded = true;
      index += 1;
      continue;
    }
    let end = index;
    while (end < turn.length && !isProse(turn[end])) end += 1;
    const span = turn.slice(index, end);
    let last = span.length - 1;
    while (last >= 0 && !isToolCall(span[last])) last -= 1;
    if (last >= 0) {
      const work = span.slice(0, last + 1);
      out.push(...work.filter((message) => message.isThinking));
      const messages = work.filter(isToolCall);
      lastBlock = {
        _isWorkBlock: true,
        messages,
        timestamp: messages[0].timestamp,
        startedAt,
        endedAt: turn[index + last + 1]?.timestamp ?? null,
        isTail: false,
      };
      out.push(lastBlock);
      openEnded = false;
    }
    out.push(...span.slice(last + 1));
    index = end;
  }

  if (!isLastTurn) return;
  if (running && openEnded) {
    out.push({
      _isWorkBlock: true,
      messages: [],
      timestamp: turn[turn.length - 1]?.timestamp ?? turnStartedAt ?? '',
      startedAt,
      endedAt: null,
      isTail: true,
    });
  } else if (lastBlock) {
    lastBlock.isTail = true;
  }
}

/**
 * Folds each turn's runs of tool calls into `TurnWorkBlockItem`s at levels
 * whose `workBlock` rule is on; returns the list untouched otherwise. Any run
 * of calls is a block - one rule, no special case for a lone read, so a reader
 * always knows where the tool activity is. While `running`, the last turn
 * ends on one even with no call in flight.
 */
export function foldTurnWork(messages: ChatMessage[], density: ToolOutputDensity = 'balanced', { running = false }: FoldOptions = {}): TurnListItem[] {
  if (!toolOutputDensityRules(density).workBlock) return messages;

  const out: TurnListItem[] = [];
  let turn: ChatMessage[] = [];
  let turnStartedAt: ChatMessage['timestamp'] | null = null;

  const flush = (isLastTurn: boolean) => {
    if (turn.length || (isLastTurn && running)) foldTurn(turn, turnStartedAt, isLastTurn, running, out);
    turn = [];
  };

  for (const message of messages) {
    if (startsTurn(message)) {
      flush(false);
      turnStartedAt = message.timestamp;
      out.push(message);
      continue;
    }
    turn.push(message);
  }
  flush(true);
  return out;
}

export type PaneListItem = MessageListItem | TurnWorkBlockItem;

/**
 * What the pane renders: turns folded into work blocks where the level says
 * so, and the messages left outside grouped by tool exactly as before. The
 * block's own contents are grouped when it is opened, so a folded turn holds
 * the same rows the pane would have shown.
 */
export function buildPaneList(messages: ChatMessage[], density: ToolOutputDensity = 'balanced', options: FoldOptions = {}): PaneListItem[] {
  const out: PaneListItem[] = [];
  let pending: ChatMessage[] = [];
  const flush = () => {
    if (pending.length) out.push(...groupConsecutiveTools(pending, density));
    pending = [];
  };

  for (const item of foldTurnWork(messages, density, options)) {
    if (isTurnWorkBlockItem(item)) {
      flush();
      out.push(item);
    } else {
      pending.push(item);
    }
  }
  flush();
  return out;
}

export interface TurnWorkSummary {
  /** Tool calls in the block, subagent containers counted once each. */
  total: number;
  counts: Record<ToolCategory, number>;
  /** Calls whose result was an error or a denial. */
  failed: number;
  /** Wall time from the turn's start to its last observed activity; null when the transcript cannot say. */
  durationMs: number | null;
}

const timeOf = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Counts by category and, when the timestamps allow it, how long the work
 * took. The duration is measured from the block's start - the prose before
 * it, else the user message that began the turn, else the first call when
 * neither is in the window - to the latest of: a call's timestamp, its
 * result's timestamp, the timestamp of what followed the block. Fewer than
 * two distinct instants means no duration rather than a guess.
 */
export function summarizeTurnWork(block: Pick<TurnWorkBlockItem, 'messages' | 'startedAt' | 'endedAt'>): TurnWorkSummary {
  const counts: Record<ToolCategory, number> = { read: 0, search: 0, command: 0, edit: 0, write: 0, web: 0, subagent: 0, other: 0 };
  let total = 0;
  let failed = 0;
  let end: number | null = timeOf(block.endedAt);
  let firstCallAt: number | null = null;

  for (const message of block.messages) {
    if (!isToolCall(message)) continue;
    total += 1;
    counts[categorizeTool(message)] += 1;
    if (hasFailedResult(message)) failed += 1;

    const calledAt = timeOf(message.timestamp);
    const resultAt = timeOf(message.toolResult?.timestamp);
    if (calledAt !== null && (firstCallAt === null || calledAt < firstCallAt)) firstCallAt = calledAt;
    for (const instant of [calledAt, resultAt]) {
      if (instant !== null && (end === null || instant > end)) end = instant;
    }
  }

  const start = timeOf(block.startedAt) ?? firstCallAt;
  const durationMs = start !== null && end !== null && end > start ? end - start : null;
  return { total, counts, failed, durationMs };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The finished row's count segments, in reading order and only the non-zero
 * ones: `5 files read · 3 commands · 2 edits`. Edits and writes are one
 * number because both changed a file, which is what the reader wants to know.
 */
export function formatTurnWorkCounts(summary: TurnWorkSummary, t: Translate): string[] {
  const { counts } = summary;
  const segments: Array<[string, number, string]> = [
    ['workBlock.filesRead', counts.read, '{{count}} files read'],
    ['workBlock.searches', counts.search, '{{count}} searches'],
    ['workBlock.commands', counts.command, '{{count}} commands'],
    ['workBlock.edits', counts.edit + counts.write, '{{count}} edits'],
    ['workBlock.webLookups', counts.web, '{{count}} web lookups'],
    ['workBlock.subagents', counts.subagent, '{{count}} subagents'],
    ['workBlock.otherTools', counts.other, '{{count}} other tools'],
  ];
  return segments
    .filter(([, count]) => count > 0)
    .map(([key, count, defaultValue]) => t(key, { count, defaultValue }));
}
