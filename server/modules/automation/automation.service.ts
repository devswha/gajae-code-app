import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rm } from 'node:fs/promises';
import net, { type Server as NetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AutomationGrantStore, type AutomationGrant } from './automation-grants.js';
import { BrowserSidecarClient, type BrowserEventListener } from './browser-sidecar-client.js';
import type { BrowserCommand, BrowserInput } from './browser-protocol.js';
import { CuaDriverClient, isCuaSafeTool, type CuaSafeTool } from './cua-client.js';

type BridgeRequest = {
  id: string;
  token: string;
  surface: 'browser' | 'computer';
  sessionId: string;
  operation?: 'open' | 'close' | 'command';
  payload?: Record<string, unknown>;
  tool?: string;
  arguments?: Record<string, unknown>;
};

const MAX_BRIDGE_LINE = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeBridgeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

export class AutomationService {
  readonly browser = new BrowserSidecarClient();
  readonly cua = new CuaDriverClient();
  readonly grants = new AutomationGrantStore();
  readonly supported = (process.env.GJC_DESKTOP === '1' && process.platform === 'darwin' && process.arch === 'arm64')
    || process.env.GAJAE_AUTOMATION === '1';
  private readonly bridgeToken = randomBytes(32).toString('hex');
  private readonly bridgePath = process.env.GAJAE_AUTOMATION_SOCKET
    ?? join(tmpdir(), `gajae-automation-${process.pid}.sock`);
  private bridge?: NetServer;

  async status() {
    const [browser, cua] = await Promise.all([
      this.supported
        ? this.browser.status().catch((error) => ({ state: 'error', installed: false, buildId: 'unknown', error: error instanceof Error ? error.message : String(error) }))
        : Promise.resolve({ state: 'idle', installed: false, buildId: 'unsupported' }),
      this.cua.status(),
    ]);
    return {
      supported: this.supported,
      platform: process.platform,
      architecture: process.arch,
      browser,
      cua,
    };
  }

  subscribeBrowser(listener: BrowserEventListener): () => void {
    return this.browser.subscribe(listener);
  }

  async openBrowser(sessionId: string, payload: { url?: string; allowDownload?: boolean; waitUntil?: string }): Promise<unknown> {
    this.requireSupported();
    return this.browser.open(sessionId, payload);
  }

  commandBrowser(sessionId: string, command: BrowserCommand, signal?: AbortSignal): Promise<unknown> {
    this.requireSupported();
    return this.browser.command(sessionId, command, signal);
  }

  inputBrowser(sessionId: string, input: BrowserInput): Promise<unknown> {
    this.requireSupported();
    return this.browser.input(sessionId, input);
  }

  async stopSession(sessionId: string): Promise<unknown> {
    this.grants.clearSession(sessionId);
    const result = await this.browser.close(sessionId).catch(() => ({ closed: false }));
    if ((await this.cua.status()).installed) {
      await this.cua.call('end_session', { session: sessionId }).catch(() => {});
    }
    return result;
  }

  grant(grant: AutomationGrant): void {
    this.grants.grant(grant);
  }

  async callComputer(sessionId: string, tool: CuaSafeTool, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    this.requireSupported();
    const withSession = { ...args, session: typeof args.session === 'string' ? args.session : sessionId };
    return this.cua.call(tool, withSession, signal);
  }

  async startBridge(): Promise<void> {
    if (!this.supported) return;
    if (this.bridge) return;
    if (process.platform !== 'win32') await rm(this.bridgePath, { force: true }).catch(() => {});
    await mkdir(join(tmpdir()), { recursive: true });
    const bridge = net.createServer((socket) => this.handleBridgeSocket(socket));
    await new Promise<void>((resolve, reject) => {
      bridge.once('error', reject);
      bridge.listen(this.bridgePath, () => {
        bridge.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') await chmod(this.bridgePath, 0o600);
    this.bridge = bridge;
    process.env.GJC_AUTOMATION_SOCKET = this.bridgePath;
    process.env.GJC_AUTOMATION_TOKEN = this.bridgeToken;
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([this.browser.shutdown(), this.cua.shutdown()]);
    const bridge = this.bridge;
    this.bridge = undefined;
    if (bridge) await new Promise<void>((resolve) => bridge.close(() => resolve()));
    if (process.platform !== 'win32') await rm(this.bridgePath, { force: true }).catch(() => {});
    delete process.env.GJC_AUTOMATION_SOCKET;
    delete process.env.GJC_AUTOMATION_TOKEN;
  }

  private requireSupported(): void {
    if (!this.supported) throw new Error('Automation is available on Apple Silicon macOS in this preview.');
  }

  private handleBridgeSocket(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_BRIDGE_LINE) {
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) void this.handleBridgeLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
  }

  private async handleBridgeLine(socket: Socket, line: string): Promise<void> {
    let request: BridgeRequest | undefined;
    try {
      request = JSON.parse(line) as BridgeRequest;
      if (request.token !== this.bridgeToken || !safeBridgeId(request.id) || !safeBridgeId(request.sessionId)) {
        throw new Error('Unauthorized automation bridge request.');
      }
      let result: unknown;
      if (request.surface === 'browser') {
        if (request.operation === 'open') result = await this.openBrowser(request.sessionId, object(request.payload));
        else if (request.operation === 'close') result = await this.stopSession(request.sessionId);
        else result = await this.commandBrowser(request.sessionId, object(request.payload?.command) as BrowserCommand);
      } else if (request.surface === 'computer' && isCuaSafeTool(request.tool)) {
        result = await this.callComputer(request.sessionId, request.tool, object(request.arguments));
      } else {
        throw new Error('Unsupported automation bridge request.');
      }
      socket.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    } catch (error) {
      socket.write(`${JSON.stringify({
        id: request && typeof request.id === 'string' ? request.id : 'invalid',
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 1_000) : 'Automation bridge request failed.',
      })}\n`);
    }
  }
}

export const automationService = new AutomationService();
