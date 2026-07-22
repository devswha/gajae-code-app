import { randomUUID } from 'node:crypto';

import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@gajae-code/coding-agent/extensibility/extensions/types';

import type { GjcWorkerWriter } from './gjc-worker.js';

type PendingAsk = {
  resolve: (answer: string | undefined) => void;
  reject: (reason: Error) => void;
  cancel: () => void;
};

type Decision = { allow?: unknown; updatedInput?: unknown; message?: unknown };

function decisionText(decision: Decision): string | undefined {
  if (typeof decision.message === 'string' && decision.message.trim()) return decision.message.trim();
  if (decision.updatedInput !== null && typeof decision.updatedInput === 'object') {
    const answers = (decision.updatedInput as Record<string, unknown>).answers;
    if (answers !== null && typeof answers === 'object') {
      const first = Object.values(answers as Record<string, unknown>).find((value) => typeof value === 'string' && value.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return undefined;
}

/** Bridges the SDK ask extension UI to Protocol v1 permission messages. */
export class GjcBunAskController {
  readonly #pending = new Map<string, PendingAsk>();
  #disposed = false;

  constructor(private readonly writer: GjcWorkerWriter) {}

  get uiContext(): ExtensionUIContext {
    return {
      select: (title, options, dialogOptions) => this.#present(title, options, undefined, dialogOptions),
      editor: (title, prefill, dialogOptions) => this.#present(title, [], prefill, dialogOptions),
    } as ExtensionUIContext;
  }

  resolve(requestId: string, value: unknown): boolean {
    const pending = this.#pending.get(requestId);
    if (!pending || this.#disposed) return false;
    const decision = value !== null && typeof value === 'object' ? value as Decision : {};
    const answer = decisionText(decision);
    if (decision.allow === true && !answer) return false;
    this.#pending.delete(requestId);
    pending.cancel();
    pending.resolve(decision.allow === true ? answer : undefined);
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const [requestId, pending] of this.#pending) {
      this.#pending.delete(requestId);
      pending.cancel();
      pending.reject(new Error('GJC ask request cancelled.'));
      this.writer.send({ kind: 'permission_cancelled', requestId });
    }
  }

  #present(title: string, options: string[], prefill?: string, dialogOptions?: ExtensionUIDialogOptions): Promise<string | undefined> {
    if (this.#disposed) return Promise.reject(new Error('GJC ask request cancelled.'));
    const requestId = `sdk-ask:${randomUUID()}`;
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout | undefined;
      const abort = () => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        this.#pending.delete(requestId);
        pending.cancel();
        pending.reject(new Error('GJC ask request cancelled.'));
        this.writer.send({ kind: 'permission_cancelled', requestId });
      };
      const cancel = () => {
        if (timeout) clearTimeout(timeout);
        dialogOptions?.signal?.removeEventListener('abort', abort);
      };
      this.#pending.set(requestId, { resolve, reject, cancel });
      if (dialogOptions?.signal?.aborted) {
        abort();
        return;
      }
      dialogOptions?.signal?.addEventListener('abort', abort, { once: true });
      if (typeof dialogOptions?.timeout === 'number' && Number.isFinite(dialogOptions.timeout) && dialogOptions.timeout >= 0) {
        timeout = setTimeout(() => {
          try {
            dialogOptions.onTimeout?.();
          } finally {
            abort();
          }
        }, dialogOptions.timeout);
      }
      this.writer.send({
        kind: 'permission_request',
        requestId,
        toolName: 'ask',
        input: {
          questions: [{
            question: title || 'GJC needs your input',
            header: 'GJC',
            options: options.map((label) => ({ label })),
            multiSelect: false,
            ...(prefill ? { prefill } : {}),
          }],
        },
      });
    });
  }
}
