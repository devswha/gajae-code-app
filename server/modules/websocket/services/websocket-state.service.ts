import type { RealtimeClientConnection } from '@/shared/types.js'; // the socket shape every service shares

// Keep the numeric transport boundary independent from the ws package for shared publishers.
export const WS_OPEN_STATE = 1; // matches WebSocket.OPEN

// Services retain actual connections here so lifecycle ownership remains with each handler.
export const connectedClients = new Set<RealtimeClientConnection>(); // every live UI socket
