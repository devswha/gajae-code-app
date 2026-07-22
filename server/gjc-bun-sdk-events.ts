import type { GjcWorkerWriter } from './gjc-worker.js';

type RecordValue = Record<string, unknown>;

export type SdkRunState = {
  abortRequested: boolean;
  terminalEmitted: boolean;
  finalError: boolean;
};

const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);

function contentText(message: unknown): string {
  if (!object(message) || !Array.isArray(message.content)) return '';
  return message.content.flatMap((part) => object(part) && typeof part.text === 'string' ? [part.text] : []).join('');
}

function usage(message: unknown): RecordValue | undefined {
  if (!object(message) || !object(message.usage)) return undefined;
  return message.usage;
}

/** Maps SDK subscription events without assigning turn terminal ownership to SDK events. */
export function forwardSdkEvent(event: unknown, writer: GjcWorkerWriter, state: SdkRunState): void {
  if (state.abortRequested || !object(event)) return;
  switch (event.type) {
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
      if (message.stopReason === 'error') {
        state.finalError = true;
        writer.send({ kind: 'error', error: 'GJC run failed.' });
        return;
      }
      const text = contentText(message);
      if (text) writer.send({ kind: 'stream_end', content: text });
      const tokenBudget = usage(message);
      if (tokenBudget) writer.send({ kind: 'status', text: 'token_budget', tokenBudget });
      return;
    }
    case 'thinking_end': {
      const content = typeof event.content === 'string' ? event.content : '';
      if (content) writer.send({ kind: 'thinking', content });
      return;
    }
    case 'tool_execution_start': {
      writer.send({ kind: 'tool_use', toolCallId: event.toolCallId, toolName: event.toolName, input: event.args });
      return;
    }
    case 'tool_execution_end': {
      writer.send({ kind: 'tool_result', toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError === true });
      return;
    }
  }
}

/** The prompt promise is the sole terminal authority. */
export function forwardPromptTerminal(writer: GjcWorkerWriter, state: SdkRunState, error?: unknown): void {
  if (state.abortRequested || state.terminalEmitted) return;
  state.terminalEmitted = true;
  if (error !== undefined || state.finalError) {
    if (!state.finalError) writer.send({ kind: 'error', error: 'GJC run failed.' });
    writer.send({ kind: 'complete', exitCode: 1 });
    return;
  }
  writer.send({ kind: 'complete', exitCode: 0 });
}
