import type { NormalizedMessage } from '@/shared/types.js';

const TOOL_OUTPUT_PREVIEW_BYTES = 64 * 1024;

/**
 * Ceiling for a tool result's structured details.
 *
 * Deliberately far below the text preview budget. Details exist to let a card
 * read a field like `resolvedPath` or an exit status; anything approaching
 * this size is a payload that has been duplicated out of the text, not
 * something a card needs.
 */
const TOOL_DETAILS_MAX_BYTES = 16 * 1024;

/**
 * Whether a details record is small enough to send.
 *
 * A value that cannot be serialized at all - cyclic, or holding something
 * JSON refuses - fails this too. That is the safe direction: it never crosses
 * the transport, and the caller marks it omitted like any other oversize
 * record.
 */
function withinDetailsBudget(value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    return json !== undefined && Buffer.byteLength(json, 'utf8') <= TOOL_DETAILS_MAX_BYTES;
  } catch {
    return false;
  }
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80;
}

function utf8SafeHeadEnd(source: Buffer, requestedEnd: number): number {
  let end = Math.min(Math.max(0, requestedEnd), source.length);
  while (end > 0 && end < source.length && isUtf8ContinuationByte(source[end])) {
    end -= 1;
  }
  return end;
}

function utf8SafeTailStart(source: Buffer, requestedStart: number): number {
  let start = Math.min(Math.max(0, requestedStart), source.length);
  while (start < source.length && isUtf8ContinuationByte(source[start])) {
    start += 1;
  }
  return start;
}

function stringifyToolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content, null, 2) ?? String(content ?? '');
  } catch {
    return String(content ?? '');
  }
}

function buildToolOutputPreview(content: unknown): {
  content: unknown;
  truncated: boolean;
  bytes: number;
} {
  const serialized = stringifyToolOutput(content);
  const bytes = Buffer.byteLength(serialized);
  if (bytes <= TOOL_OUTPUT_PREVIEW_BYTES) {
    return { content, truncated: false, bytes };
  }

  const source = Buffer.from(serialized);
  const headBytes = Math.floor(TOOL_OUTPUT_PREVIEW_BYTES * 0.75);
  const tailBytes = TOOL_OUTPUT_PREVIEW_BYTES - headBytes;
  const headEnd = utf8SafeHeadEnd(source, headBytes);
  const tailStart = utf8SafeTailStart(source, source.length - tailBytes);
  const head = source.subarray(0, headEnd).toString('utf8');
  const tail = source.subarray(tailStart).toString('utf8');
  return {
    content: `${head}\n\n… [${tailStart - headEnd} bytes omitted] …\n\n${tail}`,
    truncated: true,
    bytes,
  };
}

/**
 * Bounds tool output before it crosses an app transport boundary. Provider
 * transcripts remain authoritative and retain the full result for the
 * on-demand tool-result endpoint.
 */
export function prepareMessageForTransport(message: NormalizedMessage): NormalizedMessage {
  let prepared = message;

  if (message.kind === 'tool_result') {
    const preview = buildToolOutputPreview(message.content);
    if (preview.truncated) {
      prepared = {
        ...prepared,
        content: preview.content as string,
        toolResultTruncated: true,
        toolResultBytes: preview.bytes,
      };
    }
  }

  // Structured details are unbounded by construction: `read`, `search` and
  // `ast_grep` put a second rendering of their own output in
  // `details.displayContent.text` (the SDK's TUI prefers it over the body),
  // which is the same payload the text side already bounds. Measure the
  // serialization and drop the whole record when it is too big, rather than
  // shipping a trimmed object — a
  // consumer cannot tell which fields a trimmed object lost, so half a record
  // is worse than none. `toolDetailsOmitted` is what separates "this tool
  // reported no structure" from "there was structure and it did not fit".
  // Two shapes reach this. A live standalone tool_result carries details at
  // the top level; a folded history result carries them inside `toolResult`,
  // because the standalone row it came from is dropped before transport. Both
  // have to be bounded or the cap is only half a cap.
  if (prepared.toolUseResult !== undefined && !withinDetailsBudget(prepared.toolUseResult)) {
    prepared = { ...prepared, toolUseResult: undefined, toolDetailsOmitted: true };
  }

  const folded = prepared.toolResult;
  if (folded && folded.toolUseResult !== undefined && !withinDetailsBudget(folded.toolUseResult)) {
    const { toolUseResult: _dropped, ...rest } = folded;
    prepared = { ...prepared, toolResult: rest, toolDetailsOmitted: true };
  }

  if (message.toolResult && 'content' in message.toolResult) {
    const preview = buildToolOutputPreview(message.toolResult.content);
    if (preview.truncated) {
      prepared = {
        ...prepared,
        toolResult: {
          ...message.toolResult,
          content: preview.content as string,
        },
        toolResultTruncated: true,
        toolResultBytes: preview.bytes,
      };
    }
  }

  return prepared;
}

export function prepareMessagesForTransport(
  messages: NormalizedMessage[],
  includeImages = true,
): NormalizedMessage[] {
  return messages.map((message) => prepareMessageForTransport(
    includeImages || message.images === undefined
      ? message
      : { ...message, images: undefined },
  ));
}
