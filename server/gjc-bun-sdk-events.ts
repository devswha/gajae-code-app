import { stripVTControlCharacters } from 'node:util';

import { normalizeGjcGoal } from '../shared/gjc-goal.js';

import type { GjcSessionSnapshot } from './gjc-session-state.js';
import type { GjcWorkerWriter } from './gjc-worker.js';

/**
 * Every SDK payload field this module reads, grouped by event type.
 *
 * Events arrive here as `unknown` — the worker must stay defensive against
 * malformed frames — so a misspelled field reads `undefined` and the mapping
 * silently emits nothing. That is the exact failure this module was rewritten to
 * remove, and nothing in the type system catches it: the SDK ships its
 * declarations with extensionless relative re-exports, which do not resolve
 * under this project's `NodeNext` module resolution, so an imported
 * `AgentSessionEvent` degrades to `any`.
 *
 * `gjc-bun-sdk-events.contract.test.ts` therefore asserts this table against the
 * SDK's own type declarations on every run. Keep the two in step: add a field
 * here when you start reading it below.
 */
export const SDK_EVENT_FIELDS_READ = {
  tool_execution_start: ['toolCallId', 'toolName', 'args', 'intent'],
  tool_execution_update: ['toolCallId', 'partialResult'],
  tool_execution_end: ['toolCallId', 'toolName', 'result', 'isError'],
  auto_compaction_start: ['reason', 'action'],
  auto_compaction_end: ['action', 'result', 'aborted', 'errorMessage', 'skipped', 'continuationSkipReason'],
  auto_retry_start: ['attempt', 'maxAttempts', 'delayMs', 'errorMessage', 'unbounded'],
  auto_retry_end: ['success', 'finalError'],
  model_fallback_switched: ['from', 'to', 'reason'],
  notice: ['level', 'message', 'source'],
  goal_updated: ['goal'],
} as const satisfies Record<string, readonly string[]>;

type RecordValue = Record<string, unknown>;

export type SdkRunState = {
  /** Set once the abort has been confirmed; suppresses all further forwarding. */
  abortRequested: boolean;
  /**
   * Set synchronously the moment the user asks to stop, before the SDK's own
   * abort is awaited. The SDK emits its aborted `message_end` *during* that
   * await, so without this flag a user-requested stop would be reported to the
   * user as an unexpected interruption.
   */
  abortPending: boolean;
  terminalEmitted: boolean;
  finalError: boolean;
};

const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Removes terminal controls from SDK builtin-command output only. */
export function normalizeBuiltinCommandStdout(value: string): string {
  return stripVTControlCharacters(value);
}

/**
 * Longest notice/error text forwarded to the browser. The SDK's own strings are
 * short; the cap only exists so a pathological provider message cannot inflate a
 * frame. Protocol framing is separately bounded, so this is a display guard.
 */
const MAX_NOTICE_CHARS = 2000;

/** Trims provider-authored text to one bounded, single-block display string. */
function notice(value: unknown): string {
  const text = str(value).trim();
  if (!text) return '';
  return text.length > MAX_NOTICE_CHARS ? `${text.slice(0, MAX_NOTICE_CHARS)}…` : text;
}

function contentText(message: unknown): string {
  if (!object(message) || !Array.isArray(message.content)) return '';
  return message.content.flatMap((part) => object(part) && typeof part.text === 'string' ? [part.text] : []).join('');
}

/**
 * Maps the SDK's raw `Usage` onto the token-budget contract the composer reads.
 *
 * The SDK names its buckets `input`/`output`/`cacheRead`/`cacheWrite`, while the
 * app's `TokenUsageSummary` reads `used`/`inputTokens`/`outputTokens`. Forwarding
 * the raw object therefore renders no pill at all, so the shape is translated
 * here to match `extractGjcTokenBudget` in `gjc-sdk-bridge.ts`. `total` (the
 * context window) is not part of a message's usage and stays absent.
 */
function tokenBudget(message: unknown): RecordValue | undefined {
  if (!object(message) || !object(message.usage)) return undefined;
  const usage = message.usage;
  const inputTokens = num(usage.input);
  const outputTokens = num(usage.output);
  const cacheReadTokens = num(usage.cacheRead);
  const cacheCreationTokens = num(usage.cacheWrite);
  const used = num(usage.totalTokens) || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (used <= 0) return undefined;
  return {
    used,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens: cacheReadTokens + cacheCreationTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

/** Emits a transient status line (drives the activity indicator, not persisted). */
function status(writer: GjcWorkerWriter, text: string): void {
  if (text) writer.send({ kind: 'status', text });
}

/**
 * Drops back to the default activity label. A phase label set by a compaction or
 * retry start would otherwise keep claiming that phase is running while the model
 * is already streaming the answer.
 */
function clearStatus(writer: GjcWorkerWriter): void {
  writer.send({ kind: 'status', text: '' });
}

/** Emits a persisted system notice row so the transcript keeps the record. */
function systemNotice(writer: GjcWorkerWriter, level: 'info' | 'warning' | 'error', content: string): void {
  if (content) writer.send({ kind: 'system_notice', level, content });
}

/** Renders `auto_compaction_start` the way the CLI labels its maintenance spinner. */
function compactionStartText(event: RecordValue): string {
  const reason = event.reason === 'overflow' ? 'Context overflow detected, ' : event.reason === 'idle' ? 'Idle ' : '';
  const action = event.action === 'handoff' ? 'auto-handoff' : 'auto context-full maintenance';
  return `${reason}${action}…`;
}

/**
 * Mirrors the CLI's `#handleAutoCompactionEnd` outcome reporting. Compaction
 * rewrites the transcript, so the outcome is persisted rather than transient.
 */
function forwardCompactionEnd(event: RecordValue, writer: GjcWorkerWriter): void {
  clearStatus(writer);
  const isHandoff = event.action === 'handoff';
  // A recovery that succeeded but will not auto-continue ends the turn with no
  // answer; saying so is the difference between "done" and "nothing happened".
  if (event.continuationSkipReason !== undefined && !isHandoff) {
    systemNotice(writer, 'warning', `Context recovery finished but the turn was not resumed (${str(event.continuationSkipReason)}). Send the message again to continue.`);
    return;
  }
  if (event.aborted === true) {
    systemNotice(writer, 'info', isHandoff ? 'Auto-handoff cancelled.' : 'Auto context-full maintenance cancelled.');
    return;
  }
  const errorMessage = notice(event.errorMessage);
  if (errorMessage) {
    systemNotice(writer, 'warning', errorMessage);
    return;
  }
  if (isHandoff) {
    systemNotice(writer, 'info', 'Auto-handoff completed. The conversation continues in a new session.');
    return;
  }
  if (event.result) {
    systemNotice(writer, 'info', 'Context was compacted to free space; earlier turns are now summarized.');
    return;
  }
  if (event.skipped === true) return;
  systemNotice(writer, 'warning', 'Auto context-full maintenance failed; continuing without maintenance.');
}

/** Mirrors the CLI's retry countdown, which is the only sign a stalled run is alive. */
function forwardRetryStart(event: RecordValue, writer: GjcWorkerWriter): void {
  const attempt = num(event.attempt);
  const label = event.unbounded === true || !num(event.maxAttempts)
    ? `attempt ${attempt}`
    : `${attempt}/${num(event.maxAttempts)}`;
  const reason = notice(event.errorMessage);
  const seconds = Math.round(num(event.delayMs) / 1000);
  const delay = seconds > 0 ? ` in ${seconds}s` : '';
  status(writer, `Retrying (${label})${delay}${reason ? ` — ${reason}` : ''}`);
}

/**
 * Maps SDK subscription events without assigning turn terminal ownership to SDK events.
 *
 * `readSnapshot` is optional and supplied by the adapter, which is the only
 * place holding the live session. Without it the turn streams exactly as
 * before; with it, the end of a turn also carries the context window, model and
 * working directory the composer footer needs.
 */
export function forwardSdkEvent(
  event: unknown,
  writer: GjcWorkerWriter,
  state: SdkRunState,
  readSnapshot?: () => GjcSessionSnapshot | undefined,
): void {
  if (state.abortRequested || !object(event)) return;
  switch (event.type) {
    case 'goal_updated': {
      const goal = event.goal === null ? null : normalizeGjcGoal(event.goal);
      if (event.goal !== null && !goal) return;
      const snapshot = readSnapshot?.();
      writer.send({ kind: 'status', text: 'session_state', sessionState: {
        goal: { supported: true, runId: null, canControl: false, resumeRequired: false, ...snapshot?.goal, goal },
      } });
      return;
    }
    case 'message_update': {
      const update = object(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        writer.send({ kind: 'stream_delta', content: update.delta });
      } else if (update?.type === 'thinking_end') {
        const content = typeof update.content === 'string' ? update.content : '';
        if (content) writer.send({ kind: 'thinking', content });
      }
      return;
    }
    case 'message_end': {
      const message = event.message;
      if (!object(message) || message.role !== 'assistant') return;
      const errorMessage = notice(message.errorMessage);
      if (message.stopReason === 'error') {
        state.finalError = true;
        // The provider's own reason is what tells the user whether to retry,
        // re-authenticate, or shorten the prompt. Only fall back to the fixed
        // string when the SDK supplied nothing.
        writer.send({ kind: 'error', content: errorMessage || 'GJC run failed.' });
        return;
      }
      const text = contentText(message);
      if (text) writer.send({ kind: 'stream_end', content: text });
      if (message.stopReason === 'aborted') {
        // Without this the turn is presented as an ordinary completed answer and
        // the user acts on a truncated response. Only unexpected aborts are worth
        // reporting: the user already knows they pressed Stop, and that case is
        // in flight here (`abortRequested` is only set once the abort resolves).
        if (!state.abortPending) {
          systemNotice(writer, 'warning', errorMessage || 'The response was interrupted before it finished.');
        }
      } else if (errorMessage) {
        systemNotice(writer, 'warning', errorMessage);
      }
      const budget = tokenBudget(message);
      if (budget) writer.send({ kind: 'status', text: 'token_budget', tokenBudget: budget });
      // The context window, model and cwd live on the session rather than on
      // the message, so they ride here at the same moment the budget updates.
      const snapshot = readSnapshot?.();
      if (snapshot) writer.send({ kind: 'status', text: 'session_state', sessionState: snapshot });
      return;
    }
    case 'thinking_end': {
      const content = typeof event.content === 'string' ? event.content : '';
      if (content) writer.send({ kind: 'thinking', content });
      return;
    }
    case 'tool_execution_start': {
      // Field names must match the app's NormalizedMessage contract (`toolId`,
      // `toolInput`) — the SDK's `toolCallId`/`args` render an empty tool card
      // and never pair with their result.
      writer.send({
        kind: 'tool_use',
        toolId: str(event.toolCallId),
        toolName: str(event.toolName),
        toolInput: event.args,
        ...(notice(event.intent) ? { displayText: notice(event.intent) } : {}),
      });
      return;
    }
    case 'tool_execution_update': {
      // Streaming tool output (and a backgrounded job's real result, which only
      // ever arrives here) otherwise leaves the card frozen on its start state.
      // The event has no error flag, but its AgentToolResult envelope can carry
      // one as well as structured details, even before stdout exists. Results
      // are keyed by `toolId`, so each update supersedes the last.
      const content = stringifyToolOutput(event.partialResult);
      const details = toolResultDetails(event.partialResult);
      const isError = object(event.partialResult) && event.partialResult.isError === true;
      if (content || details !== undefined || isError) writer.send({
        kind: 'tool_result', toolId: str(event.toolCallId), content, isError, isFinal: false,
        ...(details === undefined ? {} : { toolUseResult: details }),
      });
      return;
    }
    case 'tool_execution_end': {
      const details = toolResultDetails(event.result);
      writer.send({
        kind: 'tool_result',
        toolId: str(event.toolCallId),
        content: stringifyToolOutput(event.result),
        isError: event.isError === true,
        isFinal: true,
        // The runtime returns `{ content, details }`, where `details` is the
        // typed per-tool record (a read's resolvedPath and truncation, a
        // bash run's exit status, and so on). Only `content` used to survive
        // this boundary, so a tool card could do nothing but re-parse a string
        // this file had just serialized. `toolUseResult` is the existing
        // provider-agnostic slot the client already reads.
        ...(details === undefined ? {} : { toolUseResult: details }),
      });
      return;
    }
    case 'auto_compaction_start': {
      status(writer, compactionStartText(event));
      return;
    }
    case 'auto_compaction_end': {
      forwardCompactionEnd(event, writer);
      return;
    }
    case 'auto_retry_start': {
      forwardRetryStart(event, writer);
      return;
    }
    case 'auto_retry_end': {
      clearStatus(writer);
      // Only exhaustion is worth a row; a successful retry is already evidenced
      // by the response that follows it. The payload fields are `success` and
      // `finalError`.
      if (event.success === false) {
        systemNotice(writer, 'error', notice(event.finalError) || 'Retries were exhausted and the request failed.');
      }
      return;
    }
    case 'model_fallback_switched': {
      const from = str(event.from);
      const to = str(event.to);
      if (!to) return;
      const reason = notice(event.reason);
      systemNotice(
        writer,
        'warning',
        `Model fell back${from ? ` from ${from}` : ''} to ${to}${reason ? ` — ${reason}` : ''}.`,
      );
      return;
    }
    case 'notice': {
      const content = notice(event.message);
      if (!content) return;
      const source = notice(event.source);
      const text = source ? `${source}: ${content}` : content;
      const level = event.level === 'error' ? 'error' : event.level === 'warning' ? 'warning' : 'info';
      systemNotice(writer, level, text);
      return;
    }
  }
}

/**
 * Flattens a tool result into the display text the UI renders.
 *
 * The SDK never hands back a bare string: `agent-loop`'s `coerceToolResult`
 * guarantees an `AgentToolResult` envelope — `{ content: (TextContent |
 * ImageContent)[]; details?; isError? }` — for every tool, including failures.
 * Serializing that envelope would show a JSON wrapper instead of the tool's
 * output and, for image-returning tools such as `read` on a PNG, would inline a
 * whole base64 payload into the transcript. This mirrors `stringifyGjcToolOutput`
 * in `gjc-cli.js`: take the text parts, and represent anything else by a short
 * placeholder rather than its bytes.
 */
/**
 * Pulls the runtime's structured `details` off a tool result.
 *
 * The result is `unknown` here: a tool may return a bare string, an array of
 * content parts, or the `{ content, details }` record the tool-result builder
 * produces, and only the last of those carries details. Anything else yields
 * undefined rather than a guess, so "this tool reported no structure" and
 * "this result had a shape we did not expect" collapse to the same harmless
 * outcome instead of putting junk on the wire.
 */
function toolResultDetails(value: unknown): Record<string, unknown> | undefined {
  if (!object(value)) return undefined;
  const details = value.details;
  if (!object(details)) return undefined;
  // The builder omits `details` when every field is undefined, but a tool can
  // still hand back a bare `{}`. Sending that would claim structure exists.
  return Object.keys(details).length > 0 ? details : undefined;
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return flattenContentParts(value);
  if (object(value) && Array.isArray(value.content)) return flattenContentParts(value.content);
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

function flattenContentParts(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!object(part)) return '';
      if (typeof part.text === 'string') return part.text;
      // Non-text blocks (images) carry base64 that must never become chat text.
      return typeof part.type === 'string' ? `[${part.type}]` : '';
    })
    .filter(Boolean)
    .join('');
}

/** The prompt promise is the sole terminal authority. */
export function forwardPromptTerminal(writer: GjcWorkerWriter, state: SdkRunState, error?: unknown): void {
  if (state.abortRequested || state.terminalEmitted) return;
  state.terminalEmitted = true;
  if (error !== undefined || state.finalError) {
    if (!state.finalError) writer.send({ kind: 'error', content: 'GJC run failed.' });
    writer.send({ kind: 'complete', exitCode: 1 });
    return;
  }
  writer.send({ kind: 'complete', exitCode: 0 });
}
