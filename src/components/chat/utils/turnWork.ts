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
 * The block spans the turn's first tool call to its last, inclusive, so
 * narration the model writes *between* calls stays inside, in order, and the
 * prose after the last call - the answer - stays outside. While a run streams,
 * the text after the last call renders outside as the answer; if another call
 * follows, that text was narration after all and moves into the block. That is
 * how Codex behaves, and it means the answer is never hidden behind a fold.
 *
 * Reasoning is left out of the block: it follows the density rules on its own
 * (hidden below detailed, and detailed has no block), so a thought that fell
 * inside the span is hoisted ahead of the block rather than counted as work.
 */

export interface TurnWorkBlockItem {
  _isWorkBlock: true;
  /** From the turn's first tool call to its last, in order; reasoning excluded. */
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
  /** When the user message that began this turn was sent, if it is in the window. */
  turnStartedAt: ChatMessage['timestamp'] | null;
  /** When the first message after the block (the answer) arrived, if any. */
  turnEndedAt: ChatMessage['timestamp'] | null;
  /** No user message follows: a live run, if there is one, is working on this turn. */
  isLastTurn: boolean;
}

export type TurnListItem = ChatMessage | TurnWorkBlockItem;

export function isTurnWorkBlockItem(item: PaneListItem): item is TurnWorkBlockItem {
  return Reflect.has(item, '_isWorkBlock') && (item as TurnWorkBlockItem)._isWorkBlock === true;
}

const startsTurn = (message: ChatMessage): boolean => message.type === 'user' && !message.isSystemNotice;
const isToolCall = (message: ChatMessage): boolean => Boolean(message.isToolUse);

function foldTurn(turn: ChatMessage[], turnStartedAt: ChatMessage['timestamp'] | null, isLastTurn: boolean, out: TurnListItem[]): void {
  const first = turn.findIndex(isToolCall);
  if (first < 0) {
    out.push(...turn);
    return;
  }
  let last = turn.length - 1;
  while (!isToolCall(turn[last])) last -= 1;

  out.push(...turn.slice(0, first));
  const span = turn.slice(first, last + 1);
  out.push(...span.filter((message) => message.isThinking));
  const messages = span.filter((message) => !message.isThinking);
  out.push({
    _isWorkBlock: true,
    messages,
    timestamp: messages[0].timestamp,
    turnStartedAt,
    turnEndedAt: turn[last + 1]?.timestamp ?? null,
    isLastTurn,
  });
  out.push(...turn.slice(last + 1));
}

/**
 * Folds each turn's tool calls into one `TurnWorkBlockItem` at levels whose
 * `workBlock` rule is on; returns the list untouched otherwise. Any turn with
 * at least one tool call gets a block - one rule, no special case for a lone
 * read, so a reader always knows where the tool activity is.
 */
export function foldTurnWork(messages: ChatMessage[], density: ToolOutputDensity = 'balanced'): TurnListItem[] {
  if (!toolOutputDensityRules(density).workBlock) return messages;

  const out: TurnListItem[] = [];
  let turn: ChatMessage[] = [];
  let turnStartedAt: ChatMessage['timestamp'] | null = null;

  const flush = (isLastTurn: boolean) => {
    if (turn.length) foldTurn(turn, turnStartedAt, isLastTurn, out);
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
export function buildPaneList(messages: ChatMessage[], density: ToolOutputDensity = 'balanced'): PaneListItem[] {
  const out: PaneListItem[] = [];
  let pending: ChatMessage[] = [];
  const flush = () => {
    if (pending.length) out.push(...groupConsecutiveTools(pending, density));
    pending = [];
  };

  for (const item of foldTurnWork(messages, density)) {
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
 * took. The duration is measured from the user message that began the turn
 * (or the first call, when that message is outside the window) to the latest
 * of: a call's timestamp, its result's timestamp, the answer's timestamp.
 * Fewer than two distinct instants means no duration rather than a guess.
 */
export function summarizeTurnWork(block: Pick<TurnWorkBlockItem, 'messages' | 'turnStartedAt' | 'turnEndedAt'>): TurnWorkSummary {
  const counts: Record<ToolCategory, number> = { read: 0, search: 0, command: 0, edit: 0, write: 0, web: 0, subagent: 0, other: 0 };
  let total = 0;
  let failed = 0;
  let end: number | null = timeOf(block.turnEndedAt);
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

  const start = timeOf(block.turnStartedAt) ?? firstCallAt;
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
