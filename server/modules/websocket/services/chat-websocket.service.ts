import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { GjcJobProjectionService } from '@/modules/websocket/services/gjc-job-projection.service.js';
import { getGlobalImageAssetsDir, normalizeImageDescriptors } from '@/shared/image-attachments.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';

export function filterImagesToUploadStore(images: unknown, assetsRootOverride?: string): AnyRecord[] {
  const root = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());
  return normalizeImageDescriptors(images).filter(({ path: candidate }) => {
    const relative = path.relative(root, path.resolve(root, candidate));
    const accepted = relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes(path.sep) && !relative.includes('/');
    if (!accepted) console.warn(`[Chat] Dropping image outside the upload store: ${candidate}`);
    return accepted;
  });
}

type ProviderSpawnFn = (command: string, options: AnyRecord, writer: unknown) => Promise<unknown>;
type ProviderSpawnResult = Promise<unknown> & { abortHandle?: string; };
type OAuthEvent = { method: 'oauth.phase' | 'oauth.providers.updated' | 'provider.auth.updated'; payload: AnyRecord; };
type OAuthSupervisor = {
  oauthProviders(): Promise<unknown>; oauthStatus(): Promise<unknown>; oauthStart(providerId: string): Promise<unknown>; oauthSubmit(attemptId: string, value: string): Promise<unknown>; oauthCancel(attemptId: string): Promise<unknown>; subscribeOAuth(listener: (event: OAuthEvent) => void): () => void;
};
type ChatWebSocketDependencies = {
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
  steerFns?: Partial<Record<LLMProvider, (providerSessionId: string, message: string) => boolean | Promise<boolean>>>;
  resolveToolApproval: (requestId: string, payload: { allow: boolean; updatedInput?: unknown; message?: string; rememberEntry?: unknown; }) => void;
  getPendingApprovalsForSession: (providerSessionId: string) => unknown[];
  resolveSessionModel?: (provider: LLMProvider, sessionId: string, requestedModel?: string | null) => Promise<string | undefined>;
  gjcProjection?: GjcJobProjectionService;
  oauthSupervisor?: OAuthSupervisor;
};
type OAuthAttemptOwner = { attemptId: string; userKey: string; };

const oauthTypes = new Set(['oauth.providers', 'oauth.status', 'oauth.start', 'oauth.submit', 'oauth.cancel']);
let activeOAuthOwner: OAuthAttemptOwner | null = null;

const object = (value: unknown): AnyRecord | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
const oauthKey = (userId: string | number | null): string => `${typeof userId}:${String(userId)}`;
const attemptId = (response: unknown): string | null => {
  const result = object(object(response)?.result);
  return typeof result?.attemptId === 'string' ? result.attemptId : null;
};
const ownershipError = (): AnyRecord => ({ ok: false, error: { code: 'oauth_attempt_not_owner', message: 'OAuth request failed.' } });

async function defaultResolveSessionModel(provider: LLMProvider, sessionId: string, requestedModel?: string | null): Promise<string | undefined> {
  const { providerModelsService } = await import('@/modules/providers/index.js');
  return providerModelsService.resolveResumeModel(provider, sessionId, requestedModel);
}

function requestUserId(request: AuthenticatedWebSocketRequest | undefined): string | number | null {
  const user = request?.user;
  if (!user) return null;
  return typeof user.id === 'string' || typeof user.id === 'number'
    ? user.id
    : typeof user.userId === 'string' || typeof user.userId === 'number' ? user.userId : null;
}

function reply(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) ws.send(JSON.stringify(frame));
}

function protocolFailure(ws: WebSocket, code: string, error: string, sessionId?: string): void {
  reply(ws, { kind: 'protocol_error', code, error, sessionId: sessionId ?? null, timestamp: new Date().toISOString() });
}

function requiredSessionId(data: AnyRecord): string | null {
  const value = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return value || null;
}

async function sendChat(ws: WebSocket, userId: string | number | null, data: AnyRecord, dependencies: ChatWebSocketDependencies): Promise<void> {
  const content = typeof data.content === 'string' ? data.content : '';
  if (/^\/(?:login|logout)(?:\s|$)/i.test(content.trim())) {
    protocolFailure(ws, 'LOGIN_UI_REQUIRED', 'Account authentication commands must be completed in the app login dialog.', typeof data.sessionId === 'string' ? data.sessionId : undefined);
    return;
  }
  const sessionId = requiredSessionId(data);
  if (!sessionId) {
    protocolFailure(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
    return;
  }
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    protocolFailure(ws, 'SESSION_NOT_FOUND', `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`, sessionId);
    return;
  }
  const provider = session.provider as LLMProvider;
  const spawn = dependencies.spawnFns[provider];
  if (!spawn) {
    protocolFailure(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }
  const run = chatRunRegistry.startRun({ appSessionId: sessionId, provider, providerSessionId: session.provider_session_id, connection: ws, userId });
  if (!run) {
    protocolFailure(ws, 'RUN_IN_PROGRESS', `Session "${sessionId}" already has a run in progress.`, sessionId);
    return;
  }
  const clientOptions = (data.options ?? {}) as AnyRecord;
  const requestedModel = typeof clientOptions.model === 'string' ? clientOptions.model : null;
  let model: string | undefined;
  try {
    model = await (dependencies.resolveSessionModel ?? defaultResolveSessionModel)(provider, sessionId, requestedModel);
  } catch {
    model = requestedModel ?? undefined;
  }
  const options: AnyRecord = {
    ...clientOptions, ...(model ? { model } : {}),
    images: filterImagesToUploadStore(clientOptions.images),
    sessionId: session.provider_session_id ?? undefined,
    resume: Boolean(session.provider_session_id),
    cwd: session.project_path ?? undefined,
    projectPath: session.project_path ?? undefined,
  };
  try {
    const providerRun = spawn(content, options, run.writer);
    if (provider === 'gjc') {
      const handle = (providerRun as ProviderSpawnResult).abortHandle;
      if (handle) run.writer.setAbortHandle(handle);
    }
    await providerRun;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
    if (provider === 'gjc' && code) protocolFailure(ws, code, message, sessionId);
    else run.writer.send(createNormalizedMessage({ kind: 'error', provider, sessionId: session.provider_session_id ?? sessionId, content: message }));
  } finally {
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
  }
}

async function steerChat(ws: WebSocket, data: AnyRecord, dependencies: ChatWebSocketDependencies): Promise<void> {
  const sessionId = requiredSessionId(data);
  if (!sessionId) {
    protocolFailure(ws, 'SESSION_ID_REQUIRED', 'chat.steer requires a sessionId.');
    return;
  }
  const content = typeof data.content === 'string' ? data.content : '';
  if (!content.trim()) {
    protocolFailure(ws, 'CONTENT_REQUIRED', 'chat.steer requires content.', sessionId);
    return;
  }
  const run = chatRunRegistry.getRun(sessionId);
  const destination = run
    ? (run.provider === 'gjc' ? run.writer.getAbortHandle() ?? run.providerSessionId : run.providerSessionId ?? run.writer.getAbortHandle())
    : null;
  const steer = run ? dependencies.steerFns?.[run.provider] : undefined;
  let steered = false;
  let reason: 'steered' | 'no-run' | 'not-running' | 'unsupported' | 'refused' | 'failed' = 'no-run';
  if (!run) reason = 'no-run';
  else if (run.status !== 'running') reason = 'not-running';
  else if (!steer || !destination) reason = 'unsupported';
  else try {
    steered = Boolean(await steer(destination, content));
    reason = steered ? 'steered' : 'refused';
  } catch (error) {
    console.error('[ERROR] chat.steer failed:', error instanceof Error ? error.message : String(error));
    reason = 'failed';
  }
  reply(ws, { kind: 'chat_steered', sessionId, steered, reason, content });
}

async function abortChat(ws: WebSocket, data: AnyRecord, dependencies: ChatWebSocketDependencies): Promise<void> {
  const sessionId = requiredSessionId(data);
  if (!sessionId) {
    protocolFailure(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }
  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    protocolFailure(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    return;
  }
  const id = run.provider === 'gjc' ? run.writer.getAbortHandle() ?? run.providerSessionId : run.providerSessionId ?? run.writer.getAbortHandle();
  let succeeded = false;
  try {
    if (dependencies.abortFns[run.provider] && id) succeeded = Boolean(await dependencies.abortFns[run.provider](id));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
    if (run.provider === 'gjc' && code) {
      protocolFailure(ws, code, error instanceof Error ? error.message : String(error), sessionId);
      return;
    }
    throw error;
  }
  if (!succeeded && run.provider === 'gjc') {
    protocolFailure(ws, 'ABORT_FAILED', `Session "${sessionId}" could not be aborted.`, sessionId);
    return;
  }
  chatRunRegistry.completeRun(sessionId, { exitCode: succeeded ? 0 : 1, aborted: true });
}

function subscribeChat(ws: WebSocket, data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  const requested = Array.isArray(data.sessions) ? data.sessions : [];
  for (const target of requested) {
    const targetData = object(target);
    const sessionId = typeof targetData?.sessionId === 'string' ? targetData.sessionId.trim() : '';
    if (!targetData || !sessionId) continue;
    const rawSeq = targetData.lastSeq;
    const lastSeq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? Math.max(0, Math.floor(rawSeq)) : 0;
    const run = chatRunRegistry.getRun(sessionId);
    const processing = chatRunRegistry.isProcessing(sessionId);
    if (processing) chatRunRegistry.attachConnection(sessionId, ws);
    const scope = run?.provider === 'gjc' ? run.appSessionId : run?.providerSessionId;
    const pendingPermissions = (scope ? dependencies.getPendingApprovalsForSession(scope) : []).map((approval) => {
      const value = object(approval);
      return value ? { ...value, sessionId } : approval;
    });
    reply(ws, { kind: 'chat_subscribed', sessionId, isProcessing: processing, lastSeq: run?.lastSeq ?? 0, pendingPermissions, timestamp: new Date().toISOString() });
    if (processing) for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) reply(ws, event);
  }
}

function permissionResponse(data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  if (typeof data.requestId !== 'string' || !data.requestId.length) return;
  dependencies.resolveToolApproval(data.requestId, { allow: Boolean(data.allow), updatedInput: data.updatedInput, message: typeof data.message === 'string' ? data.message : undefined, rememberEntry: data.rememberEntry });
}

async function oauthRequest(ws: WebSocket, userId: string | number | null, type: string, data: AnyRecord, oauth: OAuthSupervisor): Promise<void> {
  const userKey = oauthKey(userId);
  const wanted = typeof data.attemptId === 'string' ? data.attemptId : '';
  if ((type === 'oauth.submit' || type === 'oauth.cancel') && (activeOAuthOwner?.attemptId !== wanted || activeOAuthOwner?.userKey !== userKey)) {
    reply(ws, { kind: type, payload: ownershipError() });
    return;
  }
  const operations: Record<string, () => Promise<unknown>> = {
    'oauth.providers': () => oauth.oauthProviders(),
    'oauth.status': () => oauth.oauthStatus(),
    'oauth.start': () => oauth.oauthStart(typeof data.providerId === 'string' ? data.providerId : ''),
    'oauth.submit': () => oauth.oauthSubmit(wanted, typeof data.value === 'string' ? data.value : ''),
    'oauth.cancel': () => oauth.oauthCancel(wanted),
  };
  let response = await operations[type]!();
  if (type === 'oauth.start') {
    const id = attemptId(response);
    if (id) activeOAuthOwner = { attemptId: id, userKey };
  } else if (type === 'oauth.status') {
    const payload = object(response);
    const result = object(payload?.result);
    const reported = object(result?.attempt);
    if (reported && (activeOAuthOwner?.attemptId !== reported.attemptId || activeOAuthOwner?.userKey !== userKey)) {
      response = { ...payload, result: { ...result, attempt: undefined } };
    }
  }
  reply(ws, { kind: type, payload: response });
}

export function handleChatConnection(ws: WebSocket, request: AuthenticatedWebSocketRequest, dependencies: ChatWebSocketDependencies): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);
  const userId = requestUserId(request);
  const userKey = oauthKey(userId);
  const unsubscribe = dependencies.oauthSupervisor?.subscribeOAuth((event) => {
    if (event.method === 'oauth.phase' && (activeOAuthOwner?.attemptId !== (typeof event.payload.attemptId === 'string' ? event.payload.attemptId : '') || activeOAuthOwner?.userKey !== userKey)) return;
    reply(ws, { kind: event.method, payload: event.payload });
  }) ?? (() => {});
  const chatHandlers: Record<string, (data: AnyRecord) => Promise<void> | void> = {
    'chat.send': (data) => sendChat(ws, userId, data, dependencies),
    'chat.abort': (data) => abortChat(ws, data, dependencies),
    'chat.steer': (data) => steerChat(ws, data, dependencies),
    'chat.subscribe': (data) => subscribeChat(ws, data, dependencies),
    'chat.permission-response': (data) => permissionResponse(data, dependencies),
  };
  ws.on('message', async (raw) => {
    try {
      const parsed = parseIncomingJsonObject(raw);
      if (!parsed) throw new Error('Invalid websocket payload');
      const data = parsed as AnyRecord;
      const type = typeof data.type === 'string' ? data.type : '';
      if (await dependencies.gjcProjection?.handle(ws, data)) return;
      if (type.startsWith('oauth.')) {
        if (!oauthTypes.has(type)) protocolFailure(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${type}".`);
        else if (!dependencies.oauthSupervisor) protocolFailure(ws, 'OAUTH_UNAVAILABLE', 'App sign-in is unavailable.');
        else await oauthRequest(ws, userId, type, data, dependencies.oauthSupervisor);
        return;
      }
      const handler = chatHandlers[type];
      if (handler) await handler(data);
      else protocolFailure(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${type}".`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      protocolFailure(ws, 'INTERNAL_ERROR', message);
    }
  });
  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    unsubscribe();
    connectedClients.delete(ws);
  });
}
