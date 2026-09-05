import fsSync from 'node:fs';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { assignTranscriptTurns, type TranscriptTurnRecord } from '@/modules/providers/list/gjc/gjc-transcript-turns.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, sliceTailPage } from '@/shared/utils.js';

const PROVIDER = 'gjc';

const MAX_JSONL_LINE_BYTES = 32 * 1024 * 1024;
const MAX_BUFFERED_HISTORY_RECORDS = 5_000;
const MAX_BUFFERED_HISTORY_BYTES = 64 * 1024 * 1024;
const PAGINATION_RECORD_HEADROOM = 100;

type BufferedNormalizedMessage = {
  message: NormalizedMessage;
  byteLength: number;
};

/**
 * Retains only the newest normalized transcript records. The byte limit accounts
 * for the serialized record, which bounds the retained message strings and
 * structured tool payloads without retaining an unbounded JSONL transcript.
 */
class NormalizedMessageRingBuffer {
  private entries: Array<BufferedNormalizedMessage | undefined> = [];
  private startIndex = 0;
  private bufferedBytes = 0;

  truncated = false;

  constructor(
    private readonly maxRecords: number,
    private readonly maxBytes: number,
  ) {}

  push(message: NormalizedMessage): void {
    const byteLength = Buffer.byteLength(JSON.stringify(message), 'utf8');

    if (byteLength > this.maxBytes) {
      this.truncated = true;
      return;
    }

    while (
      this.entries.length - this.startIndex >= this.maxRecords
      || this.bufferedBytes + byteLength > this.maxBytes
    ) {
      const oldest = this.entries[this.startIndex];
      if (!oldest) {
        break;
      }
      this.entries[this.startIndex] = undefined;
      this.startIndex += 1;
      this.bufferedBytes -= oldest.byteLength;
      this.truncated = true;
    }

    this.entries.push({ message, byteLength });
    this.bufferedBytes += byteLength;

    if (this.startIndex >= 1_024) {
      this.entries = this.entries.slice(this.startIndex);
      this.startIndex = 0;
    }
  }

  get messages(): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    for (let index = this.startIndex; index < this.entries.length; index += 1) {
      const entry = this.entries[index];
      if (entry) {
        messages.push(entry.message);
      }
    }
    return messages;
  }
}

function getHistoryBufferRecordLimit(limit: number | null, offset: number): number {
  if (limit === null) {
    return MAX_BUFFERED_HISTORY_RECORDS;
  }

  return Math.min(
    MAX_BUFFERED_HISTORY_RECORDS,
    Math.max(PAGINATION_RECORD_HEADROOM, limit + offset + PAGINATION_RECORD_HEADROOM),
  );
}

/**
 * Streams newline-delimited UTF-8 text while discarding a line as soon as it
 * exceeds the cap. `readline` buffers an entire line before yielding it, which
 * would allow a malformed multi-gigabyte JSONL record to exhaust server memory.
 */
async function* readBoundedJsonlLines(sessionFilePath: string): AsyncGenerator<string> {
  const fileStream = fsSync.createReadStream(sessionFilePath);
  let lineChunks: Buffer[] = [];
  let lineByteLength = 0;
  let discardingLine = false;

  for await (const chunk of fileStream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;

    while (start < buffer.length) {
      const newlineIndex = buffer.indexOf(0x0A, start);
      const end = newlineIndex === -1 ? buffer.length : newlineIndex;
      const segmentByteLength = end - start;

      if (!discardingLine) {
        if (lineByteLength + segmentByteLength > MAX_JSONL_LINE_BYTES) {
          lineChunks = [];
          lineByteLength = 0;
          discardingLine = true;
        } else if (segmentByteLength > 0) {
          lineChunks.push(buffer.subarray(start, end));
          lineByteLength += segmentByteLength;
        }
      }

      if (newlineIndex === -1) {
        break;
      }

      if (!discardingLine) {
        const line = Buffer.concat(lineChunks, lineByteLength).toString('utf8');
        yield line.endsWith('\r') ? line.slice(0, -1) : line;
      }

      lineChunks = [];
      lineByteLength = 0;
      discardingLine = false;
      start = newlineIndex + 1;
    }
  }

  if (!discardingLine && lineByteLength > 0) {
    const line = Buffer.concat(lineChunks, lineByteLength).toString('utf8');
    yield line.endsWith('\r') ? line.slice(0, -1) : line;
  }
}
/**
 * Reads the text body of a gjc content part (`text` or `thinking`).
 */
function extractGjcPartText(part: AnyRecord): string {
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.thinking === 'string') {
    return part.thinking;
  }
  return '';
}

/**
 * Reads the transcript once for lineage alone.
 *
 * Turn assignment needs the whole chain before any record can be placed, which
 * the streaming pass below cannot provide. This pass keeps four small fields per
 * record and nothing else, so the content still streams.
 *
 * **Every** record is collected, not only the messages: lineage runs through
 * compaction and other control entries, and filtering them out severs it.
 */
async function readTranscriptLineage(sessionFilePath: string): Promise<TranscriptTurnRecord[]> {
  const records: TranscriptTurnRecord[] = [];
  for await (const line of readBoundedJsonlLines(sessionFilePath)) {
    if (!line.trim()) continue;
    let entry: AnyRecord | null;
    try {
      entry = readObjectRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!entry || typeof entry.id !== 'string') continue;
    const message = entry.type === 'message' ? readObjectRecord(entry.message) : undefined;
    const role = typeof message?.role === 'string' ? message.role : undefined;
    records.push({
      id: entry.id,
      parentId: typeof entry.parentId === 'string' ? entry.parentId : undefined,
      role: role === 'user' || role === 'assistant' || role === 'toolResult' ? role : undefined,
      stopReason: typeof message?.stopReason === 'string' ? message.stopReason : undefined,
    });
  }
  return records;
}

/**
 * Streams a gjc JSONL transcript and flattens `type:"message"` lines into the
 * compact intermediate shape consumed by `normalizeHistoryEntry`.
 *
 * Only displayable user, assistant, and tool-result messages are processed;
 * header and control events are ignored. Each `message.content[]` part becomes
 * its own intermediate record with a unique id so multi-part turns never collide.
 */
async function streamGjcSessionMessages(
  sessionId: string,
  onMessage: (message: AnyRecord) => void,
): Promise<void> {
  try {
    const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

    if (!sessionFilePath) {
      console.warn(`gjc session file not found for session ${sessionId}`);
      return;
    }

    // Which turn each record belongs to, and how that turn ended. Both come from
    // the transcript, so a reloaded conversation reports what it reported live.
    const turns = assignTranscriptTurns(await readTranscriptLineage(sessionFilePath));

    for await (const line of readBoundedJsonlLines(sessionFilePath)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as AnyRecord;
        if (entry.type !== 'message') {
          continue;
        }

        const message = readObjectRecord(entry.message);
        if (!message || message.display === false) {
          continue;
        }

        const role = typeof message.role === 'string' ? message.role : '';
        if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') {
          continue;
        }

        const timestamp = entry.timestamp;
        const entryId = typeof entry.id === 'string'
          ? entry.id
          : (typeof entry.timestamp === 'string' ? entry.timestamp : generateMessageId(PROVIDER));

        // One transcript record becomes several intermediate records - a text
        // part, a tool call, a result - and every one of them belongs to the
        // same turn. Stamping them here keeps that from being restated at each
        // emit site, where one omission would silently drop a card's contents.
        const turn = typeof entry.id === 'string' ? turns.get(entry.id) : undefined;
        const emit = (record: AnyRecord): void => {
          onMessage(turn ? { ...record, turnId: turn.turnId, turnStatus: turn.status } : record);
        };

        const content = Array.isArray(message.content)
          ? message.content
          : (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : []);

        // gjc records a tool RESULT as a top-level message with role 'toolResult'
        // whose content is plain text parts. Emit one tool_result here (paired to
        // its tool_use by toolCallId downstream) so the UI folds it into the tool
        // block instead of dumping the raw output as chat text.
        if (role === 'toolResult') {
          const output = content
            .map((rawPart) => {
              if (!rawPart || typeof rawPart !== 'object') {
                return '';
              }
              const text = (rawPart as AnyRecord).text;
              return typeof text === 'string' ? text : '';
            })
            .join('');
          // The runtime persists its typed per-tool `details` alongside the
          // text parts. Carrying it here is what keeps a reloaded transcript
          // identical to the live turn: a card that renders richly while the
          // turn streams and then degrades on refresh is worse than one that
          // is consistently plain.
          const details = message.details;
          emit({
            uuid: `${entryId}:toolresult`,
            type: 'tool_result',
            timestamp,
            toolCallId: message.toolCallId ?? message.callId,
            output,
            isError: Boolean(message.isError),
            ...(details && typeof details === 'object' && !Array.isArray(details)
              && Object.keys(details as AnyRecord).length > 0
              ? { details }
              : {}),
          });
          continue;
        }

        let partIndex = 0;
        for (const rawPart of content) {
          if (!rawPart || typeof rawPart !== 'object') {
            continue;
          }

          const part = rawPart as AnyRecord;
          const partId = `${entryId}:${partIndex}`;
          partIndex += 1;

          switch (part.type) {
            case 'text': {
              const text = typeof part.text === 'string' ? part.text : '';
              if (!text.trim()) {
                break;
              }
              emit({
                uuid: `${partId}:text`,
                timestamp,
                message: {
                  role,
                  content: text,
                },
              });
              break;
            }
            case 'thinking': {
              const text = extractGjcPartText(part);
              if (!text.trim()) {
                break;
              }
              emit({
                uuid: `${partId}:thinking`,
                type: 'thinking',
                timestamp,
                message: {
                  role: 'assistant',
                  content: text,
                },
              });
              break;
            }
            case 'toolCall': {
              emit({
                uuid: `${partId}:toolcall`,
                type: 'tool_use',
                timestamp,
                toolName: part.toolName ?? part.name ?? 'Unknown',
                toolInput: part.toolInput ?? part.input ?? part.arguments,
                toolCallId: part.toolCallId ?? part.id ?? part.callId,
              });
              break;
            }
            case 'toolResult': {
              emit({
                uuid: `${partId}:toolresult`,
                type: 'tool_result',
                timestamp,
                toolCallId: part.toolCallId ?? part.id ?? part.callId,
                output: part.output ?? part.content ?? part.result ?? '',
                isError: Boolean(part.isError),
              });
              break;
            }
            default:
              break;
          }
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } catch (error) {
    console.error(`Error reading gjc session messages for ${sessionId}:`, error);
  }
}

export class GjcSessionsProvider implements IProviderSessions {
  /**
   * Normalizes one flattened gjc content-part record into the shared envelope.
   */
  /**
   * Stamps the turn onto everything one flattened record produced.
   *
   * Done once around the normalizer rather than at each of its five returns:
   * one omission there would leave a message out of its turn, and a
   * changed-files card silently short of what the turn actually changed.
   */
  private normalizeHistoryEntry(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    const messages = this.normalizeHistoryEntryContent(raw, sessionId);
    const turnId = typeof raw.turnId === 'string' ? raw.turnId : undefined;
    if (!turnId) return messages;
    const turnStatus = raw.turnStatus as NormalizedMessage['turnStatus'];
    return messages.map((message) => ({ ...message, turnId, turnStatus }));
  }

  private normalizeHistoryEntryContent(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId(PROVIDER);

    if (raw.type === 'thinking') {
      const thinkingContent = typeof raw.message?.content === 'string'
        ? raw.message.content
        : '';
      if (!thinkingContent.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: thinkingContent,
      })];
    }

    if (raw.message?.role === 'user') {
      const content = typeof raw.message.content === 'string' ? raw.message.content : '';
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content,
      })];
    }

    if (raw.message?.role === 'assistant') {
      const content = typeof raw.message.content === 'string' ? raw.message.content : '';
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content,
      })];
    }

    if (raw.type === 'tool_use' || raw.toolName) {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName || 'Unknown',
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
      })];
    }

    if (raw.type === 'tool_result') {
      const rawOutput = raw.output;
      const content = typeof rawOutput === 'string'
        ? rawOutput
        : rawOutput == null ? '' : JSON.stringify(rawOutput);
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content,
        isError: Boolean(raw.isError),
        // Same slot the live path fills, so both produce one shape.
        ...(raw.details === undefined ? {} : { toolUseResult: raw.details }),
      })];
    }

    return [];
  }

  /**
   * Normalizes a persisted gjc history record. gjc has no live SDK event path
   * in the read-only integration, so history and (future) live events share the
   * same content-part normalization.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    return this.normalizeHistoryEntry(raw, sessionId);
  }

  /**
   * Loads gjc JSONL history and folds tool results into their tool calls.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const messageBuffer = new NormalizedMessageRingBuffer(
      getHistoryBufferRecordLimit(normalizedLimit, normalizedOffset),
      MAX_BUFFERED_HISTORY_BYTES,
    );

    try {
      await streamGjcSessionMessages(sessionId, (rawMessage) => {
        for (const message of this.normalizeHistoryEntry(rawMessage, sessionId)) {
          messageBuffer.push(message);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[GjcProvider] Failed to load session ${sessionId}:`, message);
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: normalizedOffset,
        limit: normalizedLimit,
      };
    }

    const normalized = messageBuffer.messages.sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
    );

    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          // The standalone tool_result row is dropped below, so anything the
          // UI needs has to be copied here. `toolUseResult` carries the
          // runtime's typed details; omitting it silently made a reloaded
          // transcript poorer than the turn that produced it.
          msg.toolResult = {
            content: toolResult.content,
            isError: toolResult.isError,
            ...(toolResult.toolUseResult === undefined
              ? {}
              : { toolUseResult: toolResult.toolUseResult }),
          };
        }
      }
    }

    // Tool results render inside their call, never as standalone timeline rows.
    // When the bounded ring has discarded older rows, `total` is a lower bound;
    // `hasMore` remains true so callers know the complete history was not retained.
    const visibleMessages = normalized.filter((msg) => msg.kind !== 'tool_result');
    const { page, hasMore: pageHasMore } = sliceTailPage(
      visibleMessages,
      normalizedLimit,
      normalizedOffset,
    );

    return {
      messages: page,
      total: visibleMessages.length,
      hasMore: pageHasMore || messageBuffer.truncated,
      offset: normalizedOffset,
      limit: normalizedLimit,
      tokenUsage: null,
    };
  }
}
