import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
type ConnectionOwner = string | number | null;

// Outbound half of a chat connection. The wrapped socket may be replaced in
// place when a client reconnects, so holders keep the writer - never the raw
// socket - and the session id travels with the writer across reconnects.
export class WebSocketWriter {
  ws: RealtimeClientConnection; // swapped in place on reconnect via updateWebSocket
  sessionId: string | null = null;
  userId: ConnectionOwner;
  isWebSocketWriter = true;

  constructor(connection: RealtimeClientConnection, owner: ConnectionOwner = null) {
    this.ws = connection;
    this.userId = owner;
  }

  send(payload: unknown): void {
    const connection = this.ws;
    if (connection.readyState === WS_OPEN_STATE) connection.send(JSON.stringify(payload));
  }

  updateWebSocket(connection: RealtimeClientConnection): void {
    this.ws = connection;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  getSessionId(): string | null { return this.sessionId ?? null; }
}
