import { randomUUID } from 'node:crypto';

import { createNormalizedMessage } from './shared/utils.js';
import {
  type GjcSdkFrame,
  connectGjcSdkSession,
} from './gjc-sdk-client.js';

type JsonObject = Record<string, unknown>;

type GjcSdkWriter = {
  send(value: unknown): void;
};
type GjcSdkClientLike = {
  onFrame(listener: (frame: GjcSdkFrame) => void): () => void;
  control(operation: string, input?: Record<string, unknown>): Promise<unknown>;
  query(query: string, input?: Record<string, unknown>, cursor?: string): Promise<unknown>;
  reply(id: string, answer: unknown): void;
  close(): Promise<void>;
};

export type GjcApprovalDecision = {
  allow: boolean;
  updatedInput?: unknown;
  message?: string;
  rememberEntry?: unknown;
};

type GjcQuestionOption = {
  label: string;
  description?: string;
};

type PendingGjcApproval = {
  requestId: string;
  actionId: string;
  sessionId: string;
  question: string;
  options: GjcQuestionOption[];
  input: {
    questions: Array<{
      question: string;
      header: string;
      options: GjcQuestionOption[];
      multiSelect: boolean;
    }>;
  };
  writer: GjcSdkWriter;
  client: GjcSdkClientLike;
};

const pendingByRequestId = new Map<string, PendingGjcApproval>();
const requestIdByAction = new Map<string, string>();

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstPageItem(value: unknown): JsonObject | null {
  const record = asObject(value);
  if (!record) return null;
  if (!Array.isArray(record.items)) return record;
  return asObject(record.items[0]);
}

function normalizeOptions(value: unknown): GjcQuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (typeof option === 'string' && option.trim()) {
      return [{ label: option.trim() }];
    }
    const record = asObject(option);
    const label = typeof record?.label === 'string'
      ? record.label.trim()
      : typeof record?.name === 'string'
        ? record.name.trim()
        : '';
    if (!label) return [];
    const description = typeof record?.description === 'string'
      ? record.description.trim()
      : undefined;
    return [{ label, ...(description ? { description } : {}) }];
  });
}

function actionKey(sessionId: string, actionId: string): string {
  return `${sessionId}\0${actionId}`;
}

function approvalMessage(pending: PendingGjcApproval, context?: unknown): unknown {
  return createNormalizedMessage({
    kind: 'permission_request',
    requestId: pending.requestId,
    toolName: 'AskUserQuestion',
    input: pending.input,
    context: context ?? { source: 'gjc-sdk' },
    sessionId: pending.sessionId,
    provider: 'gjc',
  });
}

function sendToWriter(writer: GjcSdkWriter, value: unknown): void {
  try {
    writer.send(value);
  } catch {
    // A disconnected UI writer must not block transport cleanup or pending-state recovery.
  }
}

function removePending(pending: PendingGjcApproval): void {
  pendingByRequestId.delete(pending.requestId);
  requestIdByAction.delete(actionKey(pending.sessionId, pending.actionId));
}

function findPendingByAction(sessionId: string, actionId: string): PendingGjcApproval | undefined {
  const requestId = requestIdByAction.get(actionKey(sessionId, actionId));
  return requestId ? pendingByRequestId.get(requestId) : undefined;
}

function negativeAnswer(options: GjcQuestionOption[]): string | undefined {
  return options.find((option) => /^(?:no|deny|reject|cancel)$/i.test(option.label))?.label;
}

function answerFromDecision(pending: PendingGjcApproval, decision: GjcApprovalDecision): unknown {
  if (!decision.allow) {
    return negativeAnswer(pending.options) ?? (decision.message?.trim() || 'No');
  }
  const updatedInput = asObject(decision.updatedInput);
  const answers = asObject(updatedInput?.answers);
  const selected = answers?.[pending.question];
  if (typeof selected === 'string' && selected.trim()) return selected.trim();
  return decision.message?.trim() || 'Skip';
}

export function extractGjcTokenBudget(
  contextResponse: unknown,
  usageResponse: unknown,
): Record<string, unknown> | null {
  const context = firstPageItem(contextResponse);
  const contextUsage = asObject(context?.usage) ?? context;
  const usage = firstPageItem(usageResponse);

  const inputTokens = finiteNumber(usage?.input) ?? 0;
  const outputTokens = finiteNumber(usage?.output) ?? 0;
  const cacheReadTokens = finiteNumber(usage?.cacheRead) ?? 0;
  const cacheCreationTokens = finiteNumber(usage?.cacheWrite) ?? 0;
  const anchoredUsed = finiteNumber(contextUsage?.tokens);
  const total = finiteNumber(contextUsage?.contextWindow);
  const used = anchoredUsed ?? (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens);

  if (
    anchoredUsed === undefined
    && total === undefined
    && inputTokens === 0
    && outputTokens === 0
    && cacheReadTokens === 0
    && cacheCreationTokens === 0
  ) {
    return null;
  }

  return {
    used,
    ...(total === undefined ? {} : { total }),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens: cacheReadTokens + cacheCreationTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
    ...(finiteNumber(usage?.cost) === undefined ? {} : { cost: finiteNumber(usage?.cost) }),
    ...(typeof contextUsage?.source === 'string' ? { source: contextUsage.source } : {}),
  };
}

export class GjcSdkBridge {
  readonly #client: GjcSdkClientLike;
  readonly #sessionId: string;
  readonly #writer: GjcSdkWriter;
  readonly #unsubscribe: () => void;
  #closed = false;

  constructor(client: GjcSdkClientLike, sessionId: string, writer: GjcSdkWriter) {
    this.#client = client;
    this.#sessionId = sessionId;
    this.#writer = writer;
    this.#unsubscribe = client.onFrame((frame) => this.#handleFrame(frame));
  }

  async abort(): Promise<boolean> {
    if (this.#closed) return false;
    try {
      await this.#client.control('turn.abort');
      return true;
    } catch {
      return false;
    }
  }

  async emitTokenBudget(): Promise<void> {
    if (this.#closed) return;
    try {
      const [context, usage] = await Promise.all([
        this.#client.query('context.get'),
        this.#client.query('usage.get'),
      ]);
      const tokenBudget = extractGjcTokenBudget(context, usage);
      if (this.#closed) return;
      if (!tokenBudget) return;
      sendToWriter(this.#writer, createNormalizedMessage({
        kind: 'status',
        text: 'token_budget',
        tokenBudget,
        sessionId: this.#sessionId,
        provider: 'gjc',
      }));
    } catch {
      // Usage enrichment is optional; NDJSON delivery remains authoritative.
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe();
    this.#cancelPending();
    try {
      await this.#client.close();
    } catch {
      // Closing the optional sidechannel is best-effort.
    }
  }

  #handleFrame(frame: GjcSdkFrame): void {
    if (frame.type === 'transport_closed') {
      if (!this.#closed) {
        this.#closed = true;
        this.#unsubscribe();
        this.#cancelPending();
      }
      return;
    }

    if (
      frame.type === 'action_needed'
      && frame.kind === 'ask'
      && typeof frame.id === 'string'
      && frame.id
    ) {
      const question = typeof frame.question === 'string' && frame.question.trim()
        ? frame.question.trim()
        : 'GJC needs your input';
      const options = normalizeOptions(frame.options);
      const existing = findPendingByAction(this.#sessionId, frame.id);
      if (existing) {
        existing.writer = this.#writer;
        sendToWriter(this.#writer, approvalMessage(existing));
        return;
      }

      const requestId = `gjc-sdk:${randomUUID()}`;
      const pending: PendingGjcApproval = {
        requestId,
        actionId: frame.id,
        sessionId: this.#sessionId,
        question,
        options,
        input: {
          questions: [{
            question,
            header: 'GJC',
            options,
            multiSelect: false,
          }],
        },
        writer: this.#writer,
        client: this.#client,
      };
      pendingByRequestId.set(requestId, pending);
      requestIdByAction.set(actionKey(this.#sessionId, frame.id), requestId);
      sendToWriter(this.#writer, approvalMessage(pending));
      return;
    }

    if (frame.type === 'action_resolved' && typeof frame.id === 'string') {
      const pending = findPendingByAction(this.#sessionId, frame.id);
      if (!pending) return;
      removePending(pending);
      sendToWriter(pending.writer, createNormalizedMessage({
        kind: 'permission_cancelled',
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        provider: 'gjc',
      }));
      return;
    }

    if (frame.type === 'reply_rejected' && typeof frame.id === 'string') {
      const pending = findPendingByAction(this.#sessionId, frame.id);
      if (!pending) return;
      sendToWriter(pending.writer, approvalMessage(pending, {
        source: 'gjc-sdk',
        replyRejected: typeof frame.reason === 'string' ? frame.reason : 'unknown',
      }));
    }
  }

  #cancelPending(): void {
    for (const pending of [...pendingByRequestId.values()]) {
      if (pending.client !== this.#client) continue;
      removePending(pending);
      sendToWriter(pending.writer, createNormalizedMessage({
        kind: 'permission_cancelled',
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        provider: 'gjc',
      }));
    }
  }
}

export async function attachGjcSdkBridge(options: {
  cwd: string;
  sessionId: string;
  writer: GjcSdkWriter;
}): Promise<GjcSdkBridge | null> {
  try {
    const client = await connectGjcSdkSession({
      cwd: options.cwd,
      sessionId: options.sessionId,
    });
    return client ? new GjcSdkBridge(client, options.sessionId, options.writer) : null;
  } catch {
    return null;
  }
}

export function resolveGjcToolApproval(
  requestId: string,
  decision: GjcApprovalDecision,
): boolean {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) return false;
  try {
    pending.client.reply(pending.actionId, answerFromDecision(pending, decision));
  } catch {
    sendToWriter(pending.writer, approvalMessage(pending, {
      source: 'gjc-sdk',
      replyRejected: 'connection_closed',
    }));
  }
  return true;
}

export function getPendingGjcApprovalsForSession(sessionId: string): unknown[] {
  return [...pendingByRequestId.values()]
    .filter((pending) => pending.sessionId === sessionId)
    .map((pending) => approvalMessage(pending));
}
