import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, rm } from 'node:fs/promises';
import net, { type Server as NetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AutomationGrantStore, type AutomationGrant } from './automation-grants.js';
import { BrowserSidecarClient, type BrowserEventListener } from './browser-sidecar-client.js';
import type { BrowserCommand, BrowserInput, BrowserSessionState } from './browser-protocol.js';
import { automationOrigin } from './automation-url.js';
import { CuaDriverClient, isCuaSafeTool, type CuaSafeTool } from './cua-client.js';

type BridgeRequest = {
  id: string;
  token: string;
  surface: 'browser' | 'computer';
  sessionId: string;
  operation?: 'open' | 'close' | 'command' | 'authorize';
  payload?: Record<string, unknown>;
  tool?: string;
  arguments?: Record<string, unknown>;
};

type CuaApplication = {
  bundle_id?: unknown;
  name?: unknown;
  pid?: unknown;
};

type CuaWindow = {
  pid?: unknown;
  window_id?: unknown;
};

type CuaApplicationAuthorization = {
  granted: boolean;
  application: string | null;
  label: string | null;
};

const MAX_BRIDGE_LINE = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeBridgeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function structuredObject(value: unknown): Record<string, unknown> {
  const record = object(value);
  return object(record.structuredContent ?? record.result ?? record);
}

function applicationRecords(value: unknown): CuaApplication[] {
  const apps = structuredObject(value).apps;
  return Array.isArray(apps)
    ? apps.filter((app): app is CuaApplication => Boolean(app && typeof app === 'object' && !Array.isArray(app)))
    : [];
}

function windowRecords(value: unknown): CuaWindow[] {
  const windows = structuredObject(value).windows;
  return Array.isArray(windows)
    ? windows.filter((window): window is CuaWindow => Boolean(window && typeof window === 'object' && !Array.isArray(window)))
    : [];
}

function cuaToolError(value: unknown): string | null {
  const record = object(value);
  if (record.isError !== true) return null;
  const content = Array.isArray(record.content) ? record.content : [];
  const message = content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => typeof item.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join('\n');
  return message || 'CUA Driver rejected the session request.';
}

function requestedPid(args: Record<string, unknown>): number | undefined {
  if (typeof args.pid === 'number' && Number.isSafeInteger(args.pid) && args.pid > 0) return args.pid;
  const target = object(args.target);
  return typeof target.pid === 'number' && Number.isSafeInteger(target.pid) && target.pid > 0
    ? target.pid
    : undefined;
}

function requestedWindowId(args: Record<string, unknown>): number | undefined {
  if (typeof args.window_id === 'number' && Number.isSafeInteger(args.window_id) && args.window_id > 0) {
    return args.window_id;
  }
  const target = object(args.target);
  return typeof target.window_id === 'number' && Number.isSafeInteger(target.window_id) && target.window_id > 0
    ? target.window_id
    : undefined;
}

const COMPUTER_DISCOVERY_TOOLS = new Set<CuaSafeTool>([
  'start_session', 'end_session', 'list_apps', 'get_accessibility_tree', 'move_cursor',
]);

/**
 * Synthetic identity for the app-owned Chrome-for-Testing sidecar. It runs
 * outside any installed app bundle, so the CUA inventory cannot resolve its
 * windows to a bundle id — without this identity every computer action against
 * the Workspace Browser window fails as "unresolvable" even though the target
 * is the app's own browser.
 */
const WORKSPACE_BROWSER_APPLICATION_ID = 'app.gajae.workspace-browser';
const WORKSPACE_BROWSER_LABEL = 'Workspace Browser';

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
  private readonly cuaSessionLabels = new Map<string, string>();

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

  async openBrowser(
    sessionId: string,
    payload: { url?: string; allowDownload?: boolean; waitUntil?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.requireSupported();
    return this.browser.open(sessionId, payload, signal);
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
    const signal = AbortSignal.timeout(2_500);
    const [browser] = await Promise.allSettled([
      this.browser.close(sessionId, signal),
      this.endComputerSession(sessionId, signal),
    ]);
    return browser.status === 'fulfilled' ? browser.value : { closed: false };
  }

  grant(grant: AutomationGrant): void {
    const value = grant.kind === 'origin' ? automationOrigin(grant.value) : grant.value.trim();
    if (!value) throw new Error('A web origin is required for this grant.');
    this.grants.grant({ ...grant, value });
  }

  async authorizeBrowser(
    sessionId: string,
    payload: { url?: unknown; scope?: unknown },
    signal?: AbortSignal,
  ): Promise<{ granted: boolean; origin: string | null }> {
    this.requireSupported();
    let rawUrl = typeof payload.url === 'string' ? payload.url : undefined;
    if (!rawUrl) {
      const state = await this.browser.state(sessionId, signal) as BrowserSessionState;
      rawUrl = state.tabs.find((tab) => tab.id === state.activeTabId)?.url;
    }
    if (!rawUrl) throw new Error('Open a browser tab before requesting browser access.');
    const origin = automationOrigin(rawUrl);
    if (!origin) return { granted: true, origin: null };
    if (payload.scope === 'session' || payload.scope === 'always') {
      this.grant({
        kind: 'origin',
        value: origin,
        scope: payload.scope,
        ...(payload.scope === 'session' ? { sessionId } : {}),
      });
    }
    return { granted: this.grants.has('origin', origin, sessionId), origin };
  }

  async authorizeComputer(
    sessionId: string,
    payload: { tool?: unknown; arguments?: unknown; scope?: unknown; application?: unknown },
    signal?: AbortSignal,
  ): Promise<CuaApplicationAuthorization> {
    this.requireSupported();
    if (!isCuaSafeTool(payload.tool)) throw new Error('Unsupported CUA Driver tool.');
    const args = object(payload.arguments);
    let application = typeof payload.application === 'string' ? payload.application.trim() : '';
    let label: string | null = null;

    if (!application && payload.tool === 'launch_app') {
      application = typeof args.bundle_id === 'string' ? args.bundle_id.trim() : '';
      label = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null;
    }

    let pid = requestedPid(args);
    const windowId = requestedWindowId(args);
    const sidecarPid = this.browser.browserPid;
    const needsApplication = payload.tool === 'launch_app'
      || pid !== undefined
      || windowId !== undefined
      || (payload.tool === 'list_windows' && args.pid !== undefined);
    if (!application && needsApplication && !(pid !== undefined && pid === sidecarPid)) {
      const inventory = await this.cua.call(
        pid === undefined && windowId !== undefined ? 'list_windows' : 'list_apps',
        {},
        signal,
      );
      if (pid === undefined && windowId !== undefined) {
        const window = windowRecords(inventory).find((candidate) => candidate.window_id === windowId);
        if (window && typeof window.pid === 'number' && Number.isSafeInteger(window.pid) && window.pid > 0) {
          pid = window.pid;
        }
      }
      let apps = applicationRecords(inventory);
      if (pid !== undefined && apps.length === 0) {
        apps = applicationRecords(await this.cua.call('list_apps', {}, signal));
      }
      const requestedName = typeof args.name === 'string' ? args.name.trim().toLocaleLowerCase() : '';
      const match = apps.find((app) => (
        (pid !== undefined && app.pid === pid)
        || (requestedName && typeof app.name === 'string' && app.name.trim().toLocaleLowerCase() === requestedName)
      ));
      if (match && typeof match.bundle_id === 'string') application = match.bundle_id.trim();
      if (match && typeof match.name === 'string' && match.name.trim()) label = match.name.trim();
    }

    if (!application && pid !== undefined && pid === sidecarPid) {
      application = WORKSPACE_BROWSER_APPLICATION_ID;
      label = WORKSPACE_BROWSER_LABEL;
    }

    if (!application) {
      if (COMPUTER_DISCOVERY_TOOLS.has(payload.tool) || (payload.tool === 'list_windows' && !needsApplication)) {
        return { granted: true, application: null, label: null };
      }
      throw new Error('Computer action requires a resolvable application identity.');
    }
    if (!label) label = application;
    if (payload.scope === 'session' || payload.scope === 'always') {
      this.grant({
        kind: 'application',
        value: application,
        scope: payload.scope,
        ...(payload.scope === 'session' ? { sessionId } : {}),
      });
    }
    return {
      granted: this.grants.has('application', application, sessionId),
      application,
      label,
    };
  }

  async callComputer(sessionId: string, tool: CuaSafeTool, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    this.requireSupported();
    const { session: _ignoredSession, ...scopedArgs } = args;
    if (tool === 'end_session') return this.endComputerSession(sessionId, signal);
    const { label, result } = await this.ensureComputerSession(
      sessionId,
      tool === 'start_session' ? scopedArgs : {},
      signal,
    );
    if (tool === 'start_session') return result;
    return this.cua.call(tool, { ...scopedArgs, session: label }, signal);
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
    const computerSessions = [...this.cuaSessionLabels.keys()];
    await Promise.allSettled([
      this.browser.shutdown(),
      ...computerSessions.map((sessionId) => this.endComputerSession(sessionId, AbortSignal.timeout(2_000))),
    ]);
    await this.cua.shutdown();
    const bridge = this.bridge;
    this.bridge = undefined;
    if (bridge) await new Promise<void>((resolve) => bridge.close(() => resolve()));
    if (process.platform !== 'win32') await rm(this.bridgePath, { force: true }).catch(() => {});
    delete process.env.GJC_AUTOMATION_SOCKET;
    delete process.env.GJC_AUTOMATION_TOKEN;
  }

  private newComputerSessionLabel(): string {
    return `gajae-${randomUUID()}`;
  }

  private async ensureComputerSession(
    sessionId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ label: string; result: unknown }> {
    let label = this.cuaSessionLabels.get(sessionId);
    const hadLabel = Boolean(label);
    if (!label) {
      label = this.newComputerSessionLabel();
      this.cuaSessionLabels.set(sessionId, label);
    }
    let result = await this.cua.call('start_session', { ...args, session: label }, signal);
    let error = cuaToolError(result);
    if (error && hadLabel) {
      // Named sessions belong to one MCP transport lease. If cua-driver or the
      // app server restarted, rotate the private label instead of exposing a
      // dead public name to the coding agent.
      label = this.newComputerSessionLabel();
      this.cuaSessionLabels.set(sessionId, label);
      result = await this.cua.call('start_session', { ...args, session: label }, signal);
      error = cuaToolError(result);
    }
    if (error) {
      this.cuaSessionLabels.delete(sessionId);
      throw new Error(error);
    }
    return { label, result };
  }

  private async endComputerSession(sessionId: string, signal?: AbortSignal): Promise<unknown> {
    const label = this.cuaSessionLabels.get(sessionId);
    this.cuaSessionLabels.delete(sessionId);
    if (!label) return { ended: false };
    return this.cua.call('end_session', { session: label }, signal);
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
    const controller = new AbortController();
    const abort = () => controller.abort();
    socket.once('close', abort);
    try {
      request = JSON.parse(line) as BridgeRequest;
      if (request.token !== this.bridgeToken || !safeBridgeId(request.id) || !safeBridgeId(request.sessionId)) {
        throw new Error('Unauthorized automation bridge request.');
      }
      let result: unknown;
      if (request.surface === 'browser') {
        if (request.operation === 'open') result = await this.openBrowser(request.sessionId, object(request.payload), controller.signal);
        else if (request.operation === 'close') result = await this.stopSession(request.sessionId);
        else if (request.operation === 'authorize') result = await this.authorizeBrowser(request.sessionId, object(request.payload), controller.signal);
        else result = await this.commandBrowser(
          request.sessionId,
          object(request.payload?.command) as BrowserCommand,
          controller.signal,
        );
      } else if (request.surface === 'computer' && request.operation === 'authorize') {
        result = await this.authorizeComputer(request.sessionId, {
          tool: request.tool,
          arguments: request.arguments,
          ...object(request.payload),
        }, controller.signal);
      } else if (request.surface === 'computer' && isCuaSafeTool(request.tool)) {
        result = await this.callComputer(request.sessionId, request.tool, object(request.arguments), controller.signal);
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
    } finally {
      socket.off('close', abort);
    }
  }
}

export const automationService = new AutomationService();
