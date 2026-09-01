import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { GjcJobProjectionService } from '@/modules/websocket/services/gjc-job-projection.service.js';
import { getGlobalImageAssetsDir, normalizeImageDescriptors } from '@/shared/image-attachments.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';

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

const asRecord = (value: unknown): AnyRecord | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
const oauthKey = (userId: string | number | null): string => `${typeof userId}:${String(userId)}`;
const ownershipError = (): AnyRecord => ({ ok: false, error: { code: 'oauth_attempt_not_owner', message: 'OAuth request failed.' } });

export function filterImagesToUploadStore(images: unknown, assetsRootOverride?: string): AnyRecord[] {
  const assetRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());
  return normalizeImageDescriptors(images).filter(({ path: imagePath }) => {
    const relativePath = path.relative(assetRoot, path.resolve(assetRoot, imagePath));
    const isStoredAsset = relativePath.length > 0
      && !relativePath.startsWith('..')
      && !path.isAbsolute(relativePath)
      && !relativePath.includes(path.sep)
      && !relativePath.includes('/');
    if (!isStoredAsset) console.warn(`[Chat] Dropping image outside the upload store: ${imagePath}`);
    return isStoredAsset;
  });
}

async function defaultResolveSessionModel(provider: LLMProvider, sessionId: string, requestedModel?: string | null): Promise<string | undefined> {
  const { providerModelsService } = await import('@/modules/providers/index.js');
  return providerModelsService.resolveResumeModel(provider, sessionId, requestedModel);
}

function requestUserId(request: AuthenticatedWebSocketRequest | undefined): string | number | null {
  const account = request?.user;
  if (!account) return null;
  if (typeof account.id === 'string' || typeof account.id === 'number') return account.id;
  return typeof account.userId === 'string' || typeof account.userId === 'number' ? account.userId : null;
}

function sendFrame(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) ws.send(JSON.stringify(frame));
}

function protocolFailure(ws: WebSocket, code: string, error: string, sessionId?: string): void {
  sendFrame(ws, { kind: 'protocol_error', code, error, sessionId: sessionId ?? null, timestamp: new Date().toISOString() });
}

function requiredSessionId(data: AnyRecord): string | null {
  const suppliedSessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return suppliedSessionId || null;
}

function providerRunId(run: NonNullable<ReturnType<typeof chatRunRegistry.getRun>>): string | null {
  if (run.provider === 'gjc') return run.writer.getAbortHandle() ?? run.providerSessionId;
  return run.providerSessionId ?? run.writer.getAbortHandle();
}

async function resolveRequestedModel(dependencies: ChatWebSocketDependencies, provider: LLMProvider, sessionId: string, requestedModel: string | null): Promise<string | undefined> {
  try {
    return await (dependencies.resolveSessionModel ?? defaultResolveSessionModel)(provider, sessionId, requestedModel);
  } catch {
    return requestedModel ?? undefined;
  }
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
  const storedSession = sessionsDb.getSessionById(sessionId);
  if (!storedSession) {
    protocolFailure(ws, 'SESSION_NOT_FOUND', `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`, sessionId);
    return;
  }

  const provider = storedSession.provider as LLMProvider;
  const spawn = dependencies.spawnFns[provider];
  if (!spawn) {
    protocolFailure(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }
  const run = chatRunRegistry.startRun({ appSessionId: sessionId, provider, providerSessionId: storedSession.provider_session_id, connection: ws, userId });
  if (!run) {
    protocolFailure(ws, 'RUN_IN_PROGRESS', `Session "${sessionId}" already has a run in progress.`, sessionId);
    return;
  }

  const requestOptions = (data.options ?? {}) as AnyRecord;
  const requestedModel = typeof requestOptions.model === 'string' ? requestOptions.model : null;
  const model = await resolveRequestedModel(dependencies, provider, sessionId, requestedModel);
  const options: AnyRecord = {
    ...requestOptions,
    ...(model ? { model } : {}),
    images: filterImagesToUploadStore(requestOptions.images),
    sessionId: storedSession.provider_session_id ?? undefined,
    resume: Boolean(storedSession.provider_session_id),
    cwd: storedSession.project_path ?? undefined,
    projectPath: storedSession.project_path ?? undefined,
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
    else run.writer.send(createNormalizedMessage({ kind: 'error', provider, sessionId: storedSession.provider_session_id ?? sessionId, content: message }));
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
  const destination = run ? providerRunId(run) : null;
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
  sendFrame(ws, { kind: 'chat_steered', sessionId, steered, reason, content });
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

  let succeeded = false;
  try {
    const abort = dependencies.abortFns[run.provider];
    const destination = providerRunId(run);
    if (abort && destination) succeeded = Boolean(await abort(destination));
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
  const subscriptions = Array.isArray(data.sessions) ? data.sessions : [];
  for (const subscription of subscriptions) {
    const request = asRecord(subscription);
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : '';
    if (!request || !sessionId) continue;

    const rawSequence = request.lastSeq;
    const lastSeq = typeof rawSequence === 'number' && Number.isFinite(rawSequence) ? Math.max(0, Math.floor(rawSequence)) : 0;
    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);
    if (isProcessing) chatRunRegistry.attachConnection(sessionId, ws);

    const approvalScope = run?.provider === 'gjc' ? run.appSessionId : run?.providerSessionId;
    const pendingPermissions = (approvalScope ? dependencies.getPendingApprovalsForSession(approvalScope) : []).map((approval) => {
      const record = asRecord(approval);
      return record ? { ...record, sessionId } : approval;
    });
    sendFrame(ws, { kind: 'chat_subscribed', sessionId, isProcessing, lastSeq: run?.lastSeq ?? 0, pendingPermissions, timestamp: new Date().toISOString() });
    if (isProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) sendFrame(ws, event);
    }
  }
}

function permissionResponse(data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  if (typeof data.requestId !== 'string' || !data.requestId.length) return;
  dependencies.resolveToolApproval(data.requestId, {
    allow: Boolean(data.allow),
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });
}

function responseAttemptId(response: unknown): string | null {
  const result = asRecord(asRecord(response)?.result);
  return typeof result?.attemptId === 'string' ? result.attemptId : null;
}

async function oauthRequest(ws: WebSocket, userId: string | number | null, type: string, data: AnyRecord, oauth: OAuthSupervisor): Promise<void> {
  const userKey = oauthKey(userId);
  const wantedAttemptId = typeof data.attemptId === 'string' ? data.attemptId : '';
  const requiresOwnership = type === 'oauth.submit' || type === 'oauth.cancel';
  if (requiresOwnership && (activeOAuthOwner?.attemptId !== wantedAttemptId || activeOAuthOwner?.userKey !== userKey)) {
    sendFrame(ws, { kind: type, payload: ownershipError() });
    return;
  }

  const requestOperations: Record<string, () => Promise<unknown>> = {
    'oauth.providers': () => oauth.oauthProviders(),
    'oauth.status': () => oauth.oauthStatus(),
    'oauth.start': () => oauth.oauthStart(typeof data.providerId === 'string' ? data.providerId : ''),
    'oauth.submit': () => oauth.oauthSubmit(wantedAttemptId, typeof data.value === 'string' ? data.value : ''),
    'oauth.cancel': () => oauth.oauthCancel(wantedAttemptId),
  };
  let response = await requestOperations[type]!();
  if (type === 'oauth.start') {
    const attemptId = responseAttemptId(response);
    if (attemptId) activeOAuthOwner = { attemptId, userKey };
  } else if (type === 'oauth.status') {
    const payload = asRecord(response);
    const result = asRecord(payload?.result);
    const attempt = asRecord(result?.attempt);
    if (attempt && (activeOAuthOwner?.attemptId !== attempt.attemptId || activeOAuthOwner?.userKey !== userKey)) {
      response = { ...payload, result: { ...result, attempt: undefined } };
    }
  }
  sendFrame(ws, { kind: type, payload: response });
}

export function handleChatConnection(ws: WebSocket, request: AuthenticatedWebSocketRequest, dependencies: ChatWebSocketDependencies): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const userId = requestUserId(request);
  const userKey = oauthKey(userId);
  const unsubscribe = dependencies.oauthSupervisor?.subscribeOAuth((event) => {
    const eventAttemptId = typeof event.payload.attemptId === 'string' ? event.payload.attemptId : '';
    if (event.method === 'oauth.phase' && (activeOAuthOwner?.attemptId !== eventAttemptId || activeOAuthOwner?.userKey !== userKey)) return;
    sendFrame(ws, { kind: event.method, payload: event.payload });
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
      const data = parseIncomingJsonObject(raw);
      if (!data) throw new Error('Invalid websocket payload');
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
