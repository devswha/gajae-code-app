import { randomUUID } from 'node:crypto';
import net from 'node:net';

import type { AutomationTools } from '@gajae-code/coding-agent/sdk/session';
import type { ExtensionUIContext } from '@gajae-code/coding-agent/extensibility/extensions/types';
import * as z from 'zod/v4';

import type { GjcPermissionMode } from './gjc-permission-policy.js';

const browserSelector = z.string().min(1).max(4096)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 4096, 'Selector exceeds 4096 UTF-8 bytes.');
const browserActionSchema = z.discriminatedUnion('verb', [
  z.strictObject({ verb: z.literal('navigate'), url: z.string().min(1).max(4096) }),
  z.strictObject({ verb: z.literal('back') }),
  z.strictObject({ verb: z.literal('forward') }),
  z.strictObject({ verb: z.literal('reload') }),
  z.strictObject({ verb: z.literal('observe') }),
  z.strictObject({ verb: z.literal('extract'), selector: browserSelector.optional(), format: z.enum(['text', 'html']).optional() }),
  z.strictObject({ verb: z.literal('click'), selector: browserSelector }),
  z.strictObject({ verb: z.literal('fill'), selector: browserSelector, text: z.string().max(64 * 1024)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 64 * 1024, 'Text exceeds 64 KiB of UTF-8.') }),
]);

const browserSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('open'), url: z.string().min(1).max(4096).optional() }),
  z.strictObject({ action: z.literal('close') }),
  z.strictObject({ action: z.literal('act'), actions: z.array(browserActionSchema).min(1).max(25) }),
]);

const computerSchema = z.object({
  action: z.enum([
    'start_session', 'end_session', 'list_apps', 'list_windows', 'get_window_state',
    'get_accessibility_tree', 'launch_app', 'set_window_frame', 'move_cursor',
    'click', 'type_text', 'press_key', 'hotkey', 'scroll', 'invoke_menu',
  ]),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

type BridgeResponse = { id: string; ok: boolean; result?: unknown; error?: string };
type BrowserBinding = { windowEpoch: string; documentEpoch: number; origin: string | null };
type BrowserAuthorization = { granted: boolean; origin: string | null; binding: BrowserBinding | null };
type ComputerAuthorization = { granted: boolean; application: string | null; label: string | null };

export type GjcAutomationBridgeTransport = {
  socketPath: string;
  token: string;
};

const ALLOW_ONCE = 'Allow once';
const ALLOW_ALWAYS = 'Always allow';
const DENY = 'Deny';
const MAX_CUA_TEXT_CHARS = 64 * 1024;
const MAX_CUA_DETAILS_CHARS = 64 * 1024;

export function takeGjcAutomationBridgeTransport(
  environment: NodeJS.ProcessEnv = process.env,
): GjcAutomationBridgeTransport | undefined {
  const socketPath = environment.GJC_AUTOMATION_SOCKET;
  const token = environment.GJC_AUTOMATION_TOKEN;
  delete environment.GJC_AUTOMATION_SOCKET;
  delete environment.GJC_AUTOMATION_TOKEN;
  if (!socketPath || !/^[a-f0-9]{64}$/iu.test(token ?? '')) return undefined;
  return { socketPath, token: token! };
}

function bridgeRequest(
  transport: GjcAutomationBridgeTransport | undefined,
  request: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 310_000,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new Error('Automation request was cancelled.'));
  if (!transport) return Promise.reject(new Error('App automation bridge is unavailable.'));
  const id = `tool-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(transport.socketPath);
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
    socket.setTimeout(timeoutMs, () => finish(new Error('Automation request timed out.')));
    socket.on('connect', () => {
      if (settled) return;
      socket.write(`${JSON.stringify({ ...request, id, token: transport.token })}\n`);
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

export async function closeGjcAutomationSession(
  appSessionId: string,
  transport: GjcAutomationBridgeTransport | undefined,
): Promise<void> {
  await bridgeRequest(transport, {
    surface: 'browser',
    sessionId: appSessionId,
    operation: 'close',
  }, undefined, 5_000);
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

function compactCuaDetails(record: Record<string, unknown>): unknown {
  const structured = record.structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return undefined;
  const { elements, tree_markdown: treeMarkdown, ...metadata } = structured as Record<string, unknown>;
  const compact = {
    ...metadata,
    ...((Array.isArray(elements) || typeof treeMarkdown === 'string') ? { omitted: {
      ...(Array.isArray(elements) ? { elements: elements.length } : {}),
      ...(typeof treeMarkdown === 'string' ? { treeMarkdownChars: treeMarkdown.length } : {}),
      reason: 'Large accessibility payload is available to the model through the tool content and was omitted from UI details.',
    } } : {}),
  };
  const serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_CUA_DETAILS_CHARS) return compact;
  return {
    omitted: {
      metadataChars: serialized.length,
      reason: 'Structured metadata exceeded the safe tool-result limit.',
    },
  };
}

function cuaResult(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return textResult(value);
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.content)) return textResult(value);

  const content: Array<
    { type: 'image'; data: string; mimeType: string }
    | { type: 'text'; text: string }
  > = [];
  for (const block of record.content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const item = block as Record<string, unknown>;
    if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') {
      content.push({ type: 'image', data: item.data, mimeType: item.mimeType });
      continue;
    }
    if (item.type === 'text' && typeof item.text === 'string') {
      const text = item.text.length > MAX_CUA_TEXT_CHARS
        ? `${item.text.slice(0, MAX_CUA_TEXT_CHARS)}\n… ${item.text.length - MAX_CUA_TEXT_CHARS} characters omitted`
        : item.text;
      content.push({ type: 'text', text });
    }
  }
  if (content.length === 0) return textResult(value);
  const details = compactCuaDetails(record);
  if (details) {
    content.push({
      type: 'text',
      text: `CUA structured metadata:\n${JSON.stringify(details, null, 2)}`,
    });
  }
  return { content, details };
}

function browserCommand(action: z.infer<typeof browserActionSchema>): Record<string, unknown> {
  const { verb, ...parameters } = action;
  return { action: verb, ...parameters };
}

function requireBrowserBinding(value: BrowserBinding | null): BrowserBinding {
  if (!value
    || typeof value.windowEpoch !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value.windowEpoch)
    || !Number.isSafeInteger(value.documentEpoch) || value.documentEpoch < 0
    || (value.origin !== null && (typeof value.origin !== 'string' || value.origin.length > 4096 || !/^https?:\/\//u.test(value.origin)))) {
    throw new Error('browser_state_unavailable: Open the built-in browser before using browser act.');
  }
  return {
    windowEpoch: value.windowEpoch,
    documentEpoch: value.documentEpoch,
    origin: value.origin,
  };
}

export function createGjcAutomationTools(
  appSessionId: string,
  ui: Pick<ExtensionUIContext, 'select'>,
  transport?: GjcAutomationBridgeTransport,
  permissionMode: GjcPermissionMode = 'ask',
): AutomationTools {
  const ensureBrowserAccess = async (url: string | undefined, signal?: AbortSignal): Promise<BrowserBinding | null> => {
    const check = await bridgeRequest(transport, {
      surface: 'browser',
      sessionId: appSessionId,
      operation: 'authorize',
      payload: { ...(url ? { url } : {}) },
    }, signal) as BrowserAuthorization;
    if (check.granted || !check.origin) return check.binding;

    // The trusted run policy covers this prompt, but must not create grants
    // that survive a later run switching back to Ask (even in this session).
    if (permissionMode === 'bypass') return check.binding;
    const choice = await ui.select(
      `Allow the agent to use ${check.origin}?`,
      [ALLOW_ONCE, ALLOW_ALWAYS, DENY],
      { signal },
    );
    if (choice !== ALLOW_ONCE && choice !== ALLOW_ALWAYS) {
      throw new Error(`Browser access to ${check.origin} was denied.`);
    }
    const granted = await bridgeRequest(transport, {
      surface: 'browser',
      sessionId: appSessionId,
      operation: 'authorize',
      payload: { url: check.origin, scope: choice === ALLOW_ALWAYS ? 'always' : 'session' },
    }, signal) as BrowserAuthorization;
    if (!granted.granted) throw new Error(`Browser access to ${check.origin} was not granted.`);
    // Bind the command to the page that was inspected before permission UI.
    // The person may navigate the WebView while the prompt is pending; using
    // the second authorization response would silently retarget the action.
    return check.binding;
  };

  const browser: NonNullable<AutomationTools['browser']> = {
    name: 'browser',
    label: 'Browser',
    description: 'Control the built-in WebView browser. Open it, observe or extract the current page, then navigate or interact using CSS selectors. The browser persists across calls.',
    parameters: browserSchema as any,
    concurrency: 'exclusive',
    async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
      const params = browserSchema.parse(rawParams);
      if (params.action === 'open') {
        if (params.url) await ensureBrowserAccess(params.url, signal);
        return textResult(await bridgeRequest(transport, {
          surface: 'browser', sessionId: appSessionId, operation: 'open',
          payload: { ...(params.url ? { url: params.url } : {}) },
        }, signal));
      }
      if (params.action === 'close') {
        return textResult(await bridgeRequest(transport, { surface: 'browser', sessionId: appSessionId, operation: 'close' }, signal));
      }
      const results = [];
      for (const action of params.actions) {
        const expected = requireBrowserBinding(await ensureBrowserAccess(
          action.verb === 'navigate' ? action.url : undefined,
          signal,
        ));
        results.push(await bridgeRequest(transport, {
          surface: 'browser', sessionId: appSessionId, operation: 'command',
          payload: { command: browserCommand(action), expected },
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
    const check = await bridgeRequest(transport, {
      surface: 'computer',
      sessionId: appSessionId,
      operation: 'authorize',
      tool,
      arguments: args,
    }, signal) as ComputerAuthorization;
    if (check.granted || !check.application) return;

    if (permissionMode === 'bypass') return;
    const choice = await ui.select(
      `Allow the agent to control ${check.label ?? check.application}?`,
      [ALLOW_ONCE, ALLOW_ALWAYS, DENY],
      { signal },
    );
    if (choice !== ALLOW_ONCE && choice !== ALLOW_ALWAYS) {
      throw new Error(`Computer access to ${check.label ?? check.application} was denied.`);
    }
    const granted = await bridgeRequest(transport, {
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

  const computer: NonNullable<AutomationTools['computer']> = {
    name: 'computer',
    label: 'Computer',
    description: 'Control a reviewed native macOS application through CUA Driver. Inspect apps/windows before acting and verify mutations with a fresh get_window_state call. Input tools default to background delivery (no focus steal), but invoke_menu must briefly front the target app because the macOS menu bar only exists for the active application. Browser pages belong in the browser tool.',
    parameters: computerSchema as any,
    concurrency: 'exclusive',
    async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
      const params = computerSchema.parse(rawParams);
      await ensureComputerAccess(params.action, params.arguments, signal);
      return cuaResult(await bridgeRequest(transport, {
        surface: 'computer', sessionId: appSessionId, tool: params.action, arguments: params.arguments,
      }, signal));
    },
  };

  return { browser, computer };
}
