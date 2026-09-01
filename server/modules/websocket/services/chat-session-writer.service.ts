import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { LLMProvider, NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';
import { prepareMessageForTransport } from '@/shared/tool-output-transport.js';
import { createCompleteMessage, readObjectRecord } from '@/shared/utils.js';

type ChatSessionWriterOptions = {
  connection: RealtimeClientConnection; appSessionId: string; userId: string | number | null; provider: LLMProvider; providerSessionId: string | null;
  onProviderSessionId: (providerSessionId: string) => void;
  decorateOutboundEvent: (message: NormalizedMessage) => NormalizedMessage | null;
};

// Adapts provider messages to the app-owned session stream.
export class ChatSessionWriter {
  ws: RealtimeClientConnection;
  userId: string | number | null;
  isWebSocketWriter = true;
  private providerSessionId: string | null;
  private abortHandle: string | null = null;

  constructor(private readonly config: ChatSessionWriterOptions) {
    this.ws = config.connection;
    this.userId = config.userId;
    this.providerSessionId = config.providerSessionId;
  }

  send(value: unknown): void {
    const record = readObjectRecord(value);
    if (!record || typeof record.kind !== 'string') {
      console.error('[ChatSessionWriter] Dropping non-normalized outbound payload', value);
      return;
    }
    const event = record as NormalizedMessage;
    if (event.kind === 'session_created') {
      const nativeId = typeof event.newSessionId === 'string' && event.newSessionId ? event.newSessionId : event.sessionId;
      if (nativeId) this.rememberNativeId(nativeId);
      return;
    }
    this.deliver(this.config.decorateOutboundEvent(prepareMessageForTransport(event)));
  }

  sendComplete(options: { exitCode: number; aborted?: boolean }): void {
    this.deliver(this.config.decorateOutboundEvent(createCompleteMessage({
      provider: this.config.provider, sessionId: this.providerSessionId, exitCode: options.exitCode, aborted: options.aborted,
    })));
  }

  updateWebSocket(connection: RealtimeClientConnection): void { this.ws = connection; }
  setSessionId(sessionId: string): void { this.rememberNativeId(sessionId); }
  getSessionId(): string | null { return this.providerSessionId; }
  getAppSessionId(): string { return this.config.appSessionId; }
  setAbortHandle(handle: string): void { this.abortHandle = handle; }
  getAbortHandle(): string | null { return this.abortHandle; }

  private rememberNativeId(id: string): void {
    if (!id || id === this.providerSessionId) return;
    this.providerSessionId = id;
    this.config.onProviderSessionId(id);
  }

  private deliver(event: NormalizedMessage | null): void {
    if (event && this.ws.readyState === WS_OPEN_STATE) this.ws.send(JSON.stringify(event));
  }
}
