import type { RealtimeClientConnection } from '@/shared/types.js';

// WebSocket.OPEN as a dependency-free transport boundary.
export const WS_OPEN_STATE = 1;

// Live chat recipients shared by services that publish browser updates.
export const connectedClients: Set<RealtimeClientConnection> = new Set();
