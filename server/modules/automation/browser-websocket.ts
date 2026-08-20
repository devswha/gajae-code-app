import type { IncomingMessage } from 'node:http';

import type WebSocket from 'ws';

import { safeSessionId } from './browser-protocol.js';
import { automationService } from './automation.service.js';

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

function binaryFrame(header: Record<string, unknown>, data: string): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header));
  const imageBytes = Buffer.from(data, 'base64');
  const packet = Buffer.allocUnsafe(4 + headerBytes.length + imageBytes.length);
  packet.writeUInt32BE(headerBytes.length, 0);
  headerBytes.copy(packet, 4);
  imageBytes.copy(packet, 4 + headerBytes.length);
  return packet;
}
export function handleBrowserConnection(ws: WebSocket, request: IncomingMessage): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  if (!safeSessionId(sessionId)) {
    ws.close(1008, 'Invalid browser session.');
    return;
  }

  const unsubscribe = automationService.subscribeBrowser((event) => {
    if (event.sessionId !== sessionId || ws.readyState !== ws.OPEN) return;
    if (event.method === 'frame') {
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES || typeof event.payload.data !== 'string') return;
      const { data, ...metadata } = event.payload;
      ws.send(binaryFrame({ type: 'frame', sessionId, ...metadata }, data), { binary: true });
      return;
    }
    ws.send(JSON.stringify({ type: event.method, sessionId, payload: event.payload }));
  });

  void automationService.browser.subscribeFrames(sessionId).catch((error) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Browser stream failed.' }));
  });

  const close = () => {
    unsubscribe();
    void automationService.browser.unsubscribeFrames(sessionId).catch(() => {});
  };
  ws.once('close', close);
  ws.once('error', close);
}
