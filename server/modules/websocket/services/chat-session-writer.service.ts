import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { LLMProvider, NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';
import { prepareMessageForTransport } from '@/shared/tool-output-transport.js';
import { createCompleteMessage, readObjectRecord } from '@/shared/utils.js';

type SessionOwner = string | number | null;
type ProviderSessionId = string | null;
type ChatSessionWriterOptions = {
  connection: RealtimeClientConnection; appSessionId: string; userId: SessionOwner;
  provider: LLMProvider; providerSessionId: ProviderSessionId;
  onProviderSessionId: (id: string) => void;
  decorateOutboundEvent: (event: NormalizedMessage) => NormalizedMessage | null;
};

// Providers speak in native session identifiers; the browser always receives the app session stream.
export class ChatSessionWriter {
  ws: RealtimeClientConnection;
  userId: SessionOwner;
  isWebSocketWriter = true;
  private providerSessionId: ProviderSessionId;
  private abortHandle: ProviderSessionId = null;

  constructor(private readonly config: ChatSessionWriterOptions) {
    this.ws = config.connection;
    this.userId = config.userId;
    this.providerSessionId = config.providerSessionId;
  }

  send(value: unknown): void {
    const message = readObjectRecord(value);
    if (!message || typeof message.kind !== 'string') {
      console.error('[ChatSessionWriter] Dropping non-normalized outbound payload', value);
      return;
    }

    const event = message as NormalizedMessage;
    if (event.kind !== 'session_created') {
      this.publish(this.config.decorateOutboundEvent(prepareMessageForTransport(event)));
      return;
    }
    const providerSessionId = typeof event.newSessionId === 'string' && event.newSessionId ? event.newSessionId : event.sessionId;
    if (providerSessionId) this.setProviderSessionId(providerSessionId);
    return;
  }

  sendComplete(options: { exitCode: number; aborted?: boolean }): void {
    const event = createCompleteMessage({
      provider: this.config.provider, sessionId: this.providerSessionId,
      exitCode: options.exitCode, aborted: options.aborted,
    });
    this.publish(this.config.decorateOutboundEvent(event));
  }

  updateWebSocket(connection: RealtimeClientConnection): void {
    this.ws = connection;
  }

  setSessionId(sessionId: NonNullable<ProviderSessionId>): void {
    this.setProviderSessionId(sessionId);
  }

  getSessionId(): ProviderSessionId {
    return this.providerSessionId;
  }

  getAppSessionId(): string {
    return this.config.appSessionId;
  }

  setAbortHandle(handle: string): void {
    this.abortHandle = handle;
  }

  getAbortHandle(): string | null {
    return this.abortHandle;
  }

  private setProviderSessionId(sessionId: string): void {
    if (!sessionId || sessionId === this.providerSessionId) return;
    this.providerSessionId = sessionId;
    this.config.onProviderSessionId(sessionId);
  }

  private publish(event: NormalizedMessage | null): void {
    if (event && this.ws.readyState === WS_OPEN_STATE) this.ws.send(JSON.stringify(event));
  }
}
