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
  /** The runtime wrote a title for this session; the app decides whether it sticks. */
  onSessionTitle: (title: string) => void;
  decorateOutboundEvent: (event: NormalizedMessage) => NormalizedMessage | null;
};

// Providers speak in native session identifiers; the browser always receives the app session stream.
//
// A run has one writer and any number of viewers: the tab that sent the turn,
// a second tab on the same session, a phone on the LAN. Every frame goes to
// every attached socket that is still open. A single "current" socket that
// each `chat.subscribe` replaced was how two viewers used to steal the stream
// from each other: each `session_upserted` made both re-subscribe, the writer
// flipped to whichever arrived last, and both saw a shredded answer.
export class ChatSessionWriter {
  userId: SessionOwner;
  isWebSocketWriter = true;
  private readonly connections = new Set<RealtimeClientConnection>();
  private providerSessionId: ProviderSessionId;
  private abortHandle: ProviderSessionId = null;

  constructor(private readonly config: ChatSessionWriterOptions) {
    this.connections.add(config.connection);
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
    // A title is not part of the transcript stream: it lands in the sessions
    // table and reaches every viewer as a `session_upserted`, never as a message.
    if (event.kind === 'session_title') {
      if (typeof event.title === 'string' && event.title.trim()) this.config.onSessionTitle(event.title.trim());
      return;
    }
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

  attachConnection(connection: RealtimeClientConnection): void {
    this.connections.add(connection);
  }

  detachConnection(connection: RealtimeClientConnection): void {
    this.connections.delete(connection);
  }

  /** Sockets that would receive the next frame; closed ones are dropped on the way. */
  connectionCount(): number {
    this.pruneClosed();
    return this.connections.size;
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

  private pruneClosed(): void {
    for (const connection of this.connections) {
      if (connection.readyState !== WS_OPEN_STATE) this.connections.delete(connection);
    }
  }

  private publish(event: NormalizedMessage | null): void {
    if (!event) return;
    this.pruneClosed();
    const payload = JSON.stringify(event);
    for (const connection of this.connections) connection.send(payload);
  }
}
