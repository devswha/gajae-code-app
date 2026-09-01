import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

export class WebSocketWriter {
  ws: RealtimeClientConnection;
  sessionId: string | null = null;
  userId: string | number | null;
  isWebSocketWriter = true;

  constructor(connection: RealtimeClientConnection, userId: string | number | null = null) {
    this.ws = connection;
    this.userId = userId;
  }

  send(payload: unknown): void {
    if (this.ws.readyState !== WS_OPEN_STATE) return;
    this.ws.send(JSON.stringify(payload));
  }

  updateWebSocket(connection: RealtimeClientConnection): void {
    this.ws = connection;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
