export const WEBSOCKET_DRAIN_CLOSE_CODE = 1001;
export const WEBSOCKET_DRAIN_REASON = 'server-draining';
const WEBSOCKET_DRAIN_TIMEOUT_MS = 250;

type DrainableWebSocket = {
  readyState: number;
  close(code: number, reason: string): void;
  terminate(): void;
  once(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
};

type WebSocketDrainOptions = {
  timeoutMs?: number;
};

const OPEN_WEBSOCKET_STATE = 1;

/**
 * Sends a graceful shutdown close frame to every open client, then forcefully
 * terminates only clients that do not close before the bounded drain timeout.
 */
export async function drainWebSocketClients(
  clients: Iterable<DrainableWebSocket>,
  { timeoutMs = WEBSOCKET_DRAIN_TIMEOUT_MS }: WebSocketDrainOptions = {}
): Promise<void> {
  const openClients = Array.from(clients).filter(client => client.readyState === OPEN_WEBSOCKET_STATE);
  if (openClients.length === 0) return;

  const survivors = new Set(openClients);
  let resolveDrain!: () => void;
  let settled = false;
  const drained = new Promise<void>(resolve => {
    resolveDrain = resolve;
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolveDrain();
  };

  const onClose = (client: DrainableWebSocket) => () => {
    survivors.delete(client);
    if (survivors.size === 0) finish();
  };

  const closeListeners = new Map<DrainableWebSocket, () => void>();
  for (const client of openClients) {
    const listener = onClose(client);
    closeListeners.set(client, listener);
    client.once('close', listener);
  }

  const timeout = setTimeout(() => {
    for (const client of survivors) {
      client.removeListener('close', closeListeners.get(client)!);
      try {
        client.terminate();
      } catch {
        // A concurrent close can make termination throw; shutdown must continue.
      }
    }
    finish();
  }, timeoutMs);

  for (const client of openClients) {
    try {
      client.close(WEBSOCKET_DRAIN_CLOSE_CODE, WEBSOCKET_DRAIN_REASON);
    } catch {
      // The bounded timeout will terminate clients that reject the close frame.
    }
  }

  await drained;
}
