import { randomUUID } from 'node:crypto';
import net from 'node:net';

import type { CustomTool } from '@gajae-code/coding-agent/extensibility/custom-tools/types';
import type { ExtensionUIContext } from '@gajae-code/coding-agent/extensibility/extensions/types';
import * as z from 'zod/v4';

const browserActionSchema = z.object({
  verb: z.enum(['navigate', 'back', 'forward', 'reload', 'click', 'type', 'fill', 'select', 'press', 'scroll', 'wait', 'observe', 'extract', 'screenshot']),
  ref: z.number().int().positive().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  values: z.array(z.string()).optional(),
  url: z.string().optional(),
  key: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  ms: z.number().int().min(0).max(30_000).optional(),
  format: z.enum(['text', 'html']).optional(),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional(),
  include_all: z.boolean().optional(),
});

const browserSchema = z.object({
  action: z.enum(['open', 'close', 'act', 'run']),
  url: z.string().optional(),
  actions: z.array(browserActionSchema).max(25).optional(),
  code: z.string().max(64 * 1024).optional(),
  timeout: z.number().int().min(1).max(300_000).optional(),
});

const computerSchema = z.object({
  action: z.enum([
    'start_session', 'end_session', 'list_apps', 'list_windows', 'get_window_state',
    'get_accessibility_tree', 'launch_app', 'set_window_frame', 'move_cursor',
    'click', 'type_text', 'press_key', 'hotkey', 'scroll', 'invoke_menu',
  ]),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

type BridgeResponse = { id: string; ok: boolean; result?: unknown; error?: string };
type BrowserAuthorization = { granted: boolean; origin: string | null };
type ComputerAuthorization = { granted: boolean; application: string | null; label: string | null };

const ALLOW_ONCE = 'Allow once';
const ALLOW_ALWAYS = 'Always allow';
const DENY = 'Deny';

function bridgeRequest(
  request: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const socketPath = process.env.GJC_AUTOMATION_SOCKET;
  const token = process.env.GJC_AUTOMATION_TOKEN;
  if (!socketPath || !token) return Promise.reject(new Error('App automation bridge is unavailable.'));
  const id = `tool-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new Error('Automation request was cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    socket.setTimeout(310_000, () => finish(new Error('Automation request timed out.')));
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ ...request, id, token })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as BridgeResponse;
        if (response.id !== id) throw new Error('Automation bridge returned a mismatched response.');
        if (!response.ok) throw new Error(response.error || 'Automation request failed.');
        finish(undefined, response.result);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Automation response was invalid.'));
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => finish(new Error('Automation bridge disconnected.')));
  });
}

function textResult(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.data === 'string' && typeof record.mimeType === 'string') {
      return {
        content: [{ type: 'image' as const, data: record.data, mimeType: record.mimeType }],
        details: value,
      };
    }
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) ?? 'Done' }],
    details: value,
  };
}

function browserCommand(action: z.infer<typeof browserActionSchema>): Record<string, unknown> {
  const { verb, wait_until, include_all, ...rest } = action;
  return {
    action: verb,
    ...rest,
    ...(wait_until ? { waitUntil: wait_until } : {}),
    ...(include_all !== undefined ? { includeAll: include_all } : {}),
    ...(verb === 'select' && !rest.values && rest.value ? { values: [rest.value] } : {}),
  };
}

export function createGjcAutomationTools(
  appSessionId: string,
  ui: Pick<ExtensionUIContext, 'select'>,
): CustomTool<any, any>[] {
  const ensureBrowserAccess = async (url: string | undefined, signal?: AbortSignal): Promise<void> => {
    const check = await bridgeRequest({
      surface: 'browser',
      sessionId: appSessionId,
      operation: 'authorize',
      payload: { ...(url ? { url } : {}) },
    }, signal) as BrowserAuthorization;
    if (check.granted || !check.origin) return;

    const choice = await ui.select(
      `Allow the agent to use ${check.origin}?`,
      [ALLOW_ONCE, ALLOW_ALWAYS, DENY],
      { signal },
    );
    if (choice !== ALLOW_ONCE && choice !== ALLOW_ALWAYS) {
      throw new Error(`Browser access to ${check.origin} was denied.`);
    }
    const granted = await bridgeRequest({
      surface: 'browser',
      sessionId: appSessionId,
      operation: 'authorize',
      payload: { url: check.origin, scope: choice === ALLOW_ALWAYS ? 'always' : 'session' },
    }, signal) as BrowserAuthorization;
    if (!granted.granted) throw new Error(`Browser access to ${check.origin} was not granted.`);
  };

  const browser: CustomTool<any, any> = {
    name: 'browser',
    label: 'Browser',
    description: 'Control the Chromium browser shared with the Gajae Browser panel. Open a session, observe accessible elements, then act using refs or selectors. The browser persists across calls.',
    parameters: browserSchema as any,
    concurrency: 'exclusive',
    async execute(_toolCallId, rawParams, _onUpdate, _ctx, signal) {
      const params = browserSchema.parse(rawParams);
      if (params.action === 'open') {
        if (params.url) await ensureBrowserAccess(params.url, signal);
        return textResult(await bridgeRequest({
          surface: 'browser', sessionId: appSessionId, operation: 'open',
          // Chromium downloads are initiated only by the user's explicit action in
          // the Browser panel. Agent calls must never silently accept the download.
          payload: { ...(params.url ? { url: params.url } : {}), allowDownload: false },
        }, signal));
      }
      if (params.action === 'close') {
        return textResult(await bridgeRequest({ surface: 'browser', sessionId: appSessionId, operation: 'close' }, signal));
      }
      if (params.action === 'run') {
        if (!params.code) throw new Error('browser run requires code.');
        await ensureBrowserAccess(undefined, signal);
        return textResult(await bridgeRequest({
          surface: 'browser', sessionId: appSessionId, operation: 'command',
          payload: { command: { action: 'run', code: params.code, timeoutMs: params.timeout } },
        }, signal));
      }
      if (!params.actions?.length) throw new Error('browser act requires one or more actions.');
      const results = [];
      for (const action of params.actions) {
        await ensureBrowserAccess(action.verb === 'navigate' ? action.url : undefined, signal);
        results.push(await bridgeRequest({
          surface: 'browser', sessionId: appSessionId, operation: 'command',
          payload: { command: browserCommand(action) },
        }, signal));
      }
      return textResult(results.length === 1 ? results[0] : results);
    },
  };

  const ensureComputerAccess = async (
    tool: z.infer<typeof computerSchema>['action'],
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> => {
    const check = await bridgeRequest({
      surface: 'computer',
      sessionId: appSessionId,
      operation: 'authorize',
      tool,
      arguments: args,
    }, signal) as ComputerAuthorization;
    if (check.granted || !check.application) return;

    const choice = await ui.select(
      `Allow the agent to control ${check.label ?? check.application}?`,
      [ALLOW_ONCE, ALLOW_ALWAYS, DENY],
      { signal },
    );
    if (choice !== ALLOW_ONCE && choice !== ALLOW_ALWAYS) {
      throw new Error(`Computer access to ${check.label ?? check.application} was denied.`);
    }
    const granted = await bridgeRequest({
      surface: 'computer',
      sessionId: appSessionId,
      operation: 'authorize',
      tool,
      arguments: args,
      payload: {
        application: check.application,
        scope: choice === ALLOW_ALWAYS ? 'always' : 'session',
      },
    }, signal) as ComputerAuthorization;
    if (!granted.granted) throw new Error(`Computer access to ${check.label ?? check.application} was not granted.`);
  };

  const computer: CustomTool<any, any> = {
    name: 'computer',
    label: 'Computer',
    description: 'Control a reviewed native macOS application through CUA Driver. Inspect apps/windows before acting and verify mutations with a fresh get_window_state call. Browser pages belong in the browser tool.',
    parameters: computerSchema as any,
    concurrency: 'exclusive',
    async execute(_toolCallId, rawParams, _onUpdate, _ctx, signal) {
      const params = computerSchema.parse(rawParams);
      await ensureComputerAccess(params.action, params.arguments, signal);
      return textResult(await bridgeRequest({
        surface: 'computer', sessionId: appSessionId, tool: params.action, arguments: params.arguments,
      }, signal));
    },
  };

  return [browser, computer];
}
