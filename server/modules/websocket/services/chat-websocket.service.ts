import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { getGlobalImageAssetsDir, normalizeImageDescriptors } from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
} from '@/shared/types.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';
import type { GjcJobProjectionService } from '@/modules/websocket/services/gjc-job-projection.service.js';

/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global upload store (`~/.gajae-app/assets`,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterImagesToUploadStore(images: unknown, assetsRootOverride?: string): AnyRecord[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeImageDescriptors(images).filter((descriptor) => {
    // Relative paths are anchored in the store; absolute ones must already be in it.
    const resolved = path.resolve(assetsRoot, descriptor.path);
    const relative = path.relative(assetsRoot, resolved);
    const isDirectChild =
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep) &&
      !relative.includes('/');

    if (!isDirectChild) {
      console.warn(`[Chat] Dropping image outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/**
 * One provider runtime entry point. All five runtimes share this signature,
 * which lets the chat handler dispatch through a provider-keyed map instead
 * of provider-specific branches.
 */
type ProviderSpawnFn = (
  command: string,
  options: AnyRecord,
  writer: unknown
) => Promise<unknown>;
type ProviderSpawnResult = Promise<unknown> & {
  abortHandle?: string;
};

type OAuthEvent = {
  method: 'oauth.phase' | 'oauth.providers.updated' | 'provider.auth.updated';
  payload: AnyRecord;
};

type OAuthSupervisor = {
  oauthProviders(): Promise<unknown>;
  oauthStatus(): Promise<unknown>;
  oauthStart(providerId: string): Promise<unknown>;
  oauthSubmit(attemptId: string, value: string): Promise<unknown>;
  oauthCancel(attemptId: string): Promise<unknown>;
  subscribeOAuth(listener: (event: OAuthEvent) => void): () => void;
};
const OAUTH_MESSAGE_TYPES = new Set([
  'oauth.providers',
  'oauth.status',
  'oauth.start',
  'oauth.submit',
  'oauth.cancel',
]);
type OAuthAttemptOwner = {
  attemptId: string;
  userKey: string;
};

let latestOAuthAttemptOwner: OAuthAttemptOwner | null = null;

const oauthUserKey = (userId: string | number | null): string => `${typeof userId}:${String(userId)}`;

function oauthRecord(value: unknown): AnyRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function oauthAttemptIdFromResponse(response: unknown): string | null {
  const payload = oauthRecord(response);
  const result = oauthRecord(payload?.result);
  return typeof result?.attemptId === 'string' ? result.attemptId : null;
}

function oauthOwnershipFailure(): AnyRecord {
  return {
    ok: false,
    error: {
      code: 'oauth_attempt_not_owner',
      message: 'OAuth request failed.',
    },
  };
}



type ChatWebSocketDependencies = {
  /** Provider runtimes keyed by provider id. */
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  /**
   * Abort functions are normally addressed with a provider-native session id.
   * A fresh gjc run uses its in-memory abort handle until that id arrives.
   */
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
  /**
   * Delivers a message into a run that is already streaming, addressed like an
   * abort. Optional per provider: a runtime that cannot reach a live turn simply
   * has no entry, and the client keeps the message queued instead.
   */
  steerFns?: Partial<Record<LLMProvider, (providerSessionId: string, message: string) => boolean | Promise<boolean>>>;
  resolveToolApproval: (
    requestId: string,
    payload: {
      allow: boolean;
      updatedInput?: unknown;
      message?: string;
      rememberEntry?: unknown;
    }
  ) => void;
  /** Provider-runtime approvals included in `chat_subscribed` after reconnect. */
  getPendingApprovalsForSession: (providerSessionId: string) => unknown[];
  /**
   * Per-session model resolution (injectable for tests). The default consults
   * the persisted active-model change store so a model picked for a session
   * survives page reloads and session switches instead of depending on the
   * client's global localStorage value.
   */
  resolveSessionModel?: (
    provider: LLMProvider,
    sessionId: string,
    requestedModel?: string | null,
  ) => Promise<string | undefined>;
  gjcProjection?: GjcJobProjectionService;
  oauthSupervisor?: OAuthSupervisor;
};

async function defaultResolveSessionModel(
  provider: LLMProvider,
  sessionId: string,
  requestedModel?: string | null,
): Promise<string | undefined> {
  const { providerModelsService } = await import('@/modules/providers/index.js');
  return providerModelsService.resolveResumeModel(provider, sessionId, requestedModel);
}

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 */
function sendProtocolError(
  ws: WebSocket,
  code: string,
  error: string,
  sessionId?: string
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  });
}

function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}

/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const command = typeof data.content === 'string' ? data.content : '';
  if (/^\/(?:login|logout)(?:\s|$)/i.test(command.trim())) {
    sendProtocolError(
      ws,
      'LOGIN_UI_REQUIRED',
      'Account authentication commands must be completed in the app login dialog.',
      typeof data.sessionId === 'string' ? data.sessionId : undefined,
    );
    return;
  }

  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
    return;
  }

  const provider = session.provider as LLMProvider;
  const spawnFn = dependencies.spawnFns[provider];
  if (!spawnFn) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
  });

  if (!run) {
    sendProtocolError(
      ws,
      'RUN_IN_PROGRESS',
      `Session "${sessionId}" already has a run in progress.`,
      sessionId
    );
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;

  // The session's persisted model choice outranks the client's global default:
  // the active-model POST stores per-session picks under the app session id,
  // and this is the only place runs are dispatched.
  const requestedModel = typeof clientOptions.model === 'string' ? clientOptions.model : null;
  let resolvedModel: string | undefined;
  try {
    resolvedModel = await (dependencies.resolveSessionModel ?? defaultResolveSessionModel)(
      provider,
      sessionId,
      requestedModel,
    );
  } catch {
    resolvedModel = requestedModel ?? undefined;
  }

  // The provider runtimes receive the provider-native session id (that is the
  // id their CLI/SDK understands for resume). Brand-new sessions have no
  // provider id yet, so the runtime starts fresh and announces one, which the
  // gateway writer captures and maps back to the app session id.
  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    ...(resolvedModel ? { model: resolvedModel } : {}),
    // Image attachments are re-validated server-side: only files inside the
    // global upload store may reach the provider runtimes' file reads.
    images: filterImagesToUploadStore(clientOptions.images),
    sessionId: session.provider_session_id ?? undefined,
    resume: Boolean(session.provider_session_id),
    cwd: session.project_path ?? undefined,
    projectPath: session.project_path ?? undefined,
  };

  try {
    const providerRun = spawnFn(command, runtimeOptions, run.writer);
    if (provider === 'gjc') {
      const abortHandle = (providerRun as ProviderSpawnResult).abortHandle;
      if (abortHandle) {
        run.writer.setAbortHandle(abortHandle);
      }
    }
    await providerRun;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    if (provider === 'gjc' && code) {
      sendProtocolError(ws, code, message, sessionId);
    } else if (run.status === 'running') {
      run.writer.send(createNormalizedMessage({
        kind: 'error',
        provider,
        sessionId: session.provider_session_id ?? sessionId,
        content: message,
      }));
    }
    // A run that already passed its terminal `complete` reported the failure
    // itself (GJC forwards `error` + `complete` before rejecting), so a second
    // bubble here is the same failure rendered twice in the transcript. The
    // console line above keeps the rejection visible server-side either way.
  } finally {
    // Safety net: a runtime that crashed (or resolved) without emitting its
    // terminal `complete` would otherwise leave the session stuck in
    // "processing" forever on every connected client. Scoped to THIS run —
    // a queued message can start the session's next run before this promise
    // settles, and the session-keyed completeRun would kill that new run.
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
  }
}

/**
 * Handles `chat.steer`: hands a message to the turn that is already running.
 *
 * Answers `chat.steered` with whether the runtime took it. A false answer is
 * not an error — it means the turn settled first, or this provider cannot steer
 * — and the client queues the message instead of losing it.
 */
async function handleChatSteer(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.steer requires a sessionId.');
    return;
  }

  const content = typeof data.content === 'string' ? data.content : '';
  if (!content.trim()) {
    sendProtocolError(ws, 'CONTENT_REQUIRED', 'chat.steer requires content.', sessionId);
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  const steerFn = run ? dependencies.steerFns?.[run.provider] : undefined;
  const steerSessionId = run
    ? (run.provider === 'gjc'
      ? run.writer.getAbortHandle() ?? run.providerSessionId
      : run.providerSessionId ?? run.writer.getAbortHandle())
    : null;

  // Why a message was not taken is the difference between "ask again" and
  // "never ask this provider", so it travels with the answer instead of being
  // flattened into a bare false.
  let steered = false;
  let reason: 'steered' | 'no-run' | 'not-running' | 'unsupported' | 'refused' | 'failed' = 'no-run';
  if (!run) {
    reason = 'no-run';
  } else if (run.status !== 'running') {
    reason = 'not-running';
  } else if (!steerFn || !steerSessionId) {
    reason = 'unsupported';
  } else {
    try {
      steered = Boolean(await steerFn(steerSessionId, content));
      reason = steered ? 'steered' : 'refused';
    } catch (error) {
      console.error('[ERROR] chat.steer failed:', error instanceof Error ? error.message : String(error));
      reason = 'failed';
    }
  }

  // Its own kind, like protocol_error: the client has to tell "the turn took
  // your message" apart from any provider message the run itself emits.
  sendJson(ws, { kind: 'chat_steered', sessionId, steered, reason, content });
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    return;
  }

  const abortFn = dependencies.abortFns[run.provider];
  const abortSessionId = run.provider === 'gjc'
    ? run.writer.getAbortHandle() ?? run.providerSessionId
    : run.providerSessionId ?? run.writer.getAbortHandle();
  let success = false;
  try {
    if (abortFn && abortSessionId) {
      success = Boolean(await abortFn(abortSessionId));
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
    if (run.provider === 'gjc' && code) {
      sendProtocolError(ws, code, error instanceof Error ? error.message : String(error), sessionId);
      return;
    }
    throw error;
  }
  if (!success && run.provider === 'gjc') {
    sendProtocolError(ws, 'ABORT_FAILED', `Session "${sessionId}" could not be aborted.`, sessionId);
    return;
  }

  chatRunRegistry.completeRun(sessionId, {
    exitCode: success ? 0 : 1,
    aborted: true,
  });
}

/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): void {
  const targets = Array.isArray(data.sessions) ? data.sessions : [];

  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue;
    }

    const sessionId = typeof (target as AnyRecord).sessionId === 'string'
      ? ((target as AnyRecord).sessionId as string).trim()
      : '';
    if (!sessionId) {
      continue;
    }

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);

    // Future live events for this run should land on the socket that asked —
    // this is what makes mid-stream page refreshes work for all providers.
    if (isProcessing) {
      chatRunRegistry.attachConnection(sessionId, ws);
    }

    // Most provider runtimes track approvals under their provider-native id.
    // GJC's app-owned automation bridge deliberately scopes them to the stable
    // app session id so reconnects cannot leak an approval across app sessions.
    const approvalScope = run?.provider === 'gjc'
      ? run.appSessionId
      : run?.providerSessionId;
    const pendingPermissions = (approvalScope
      ? dependencies.getPendingApprovalsForSession(approvalScope)
      : []
    ).map((approval) =>
      approval && typeof approval === 'object'
        ? { ...(approval as AnyRecord), sessionId }
        : approval,
    );

    sendJson(ws, {
      kind: 'chat_subscribed',
      sessionId,
      isProcessing,
      lastSeq: run?.lastSeq ?? 0,
      pendingPermissions,
      timestamp: new Date().toISOString(),
    });

    // Replay only for RUNNING runs, strictly after the ack. Completed runs
    // are fully persisted to the provider transcript and served over REST —
    // replaying them (e.g. after a page reload where the client's lastSeq is
    // 0) would duplicate messages the history fetch already returned.
    if (isProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) {
        sendJson(ws, event);
      }
    }
  }
}

/**
 * Handles `chat.permission-response`: forwards a tool-approval decision to the
 * pending approval resolver (Claude is the only provider with interactive
 * approvals today, but the message is intentionally provider-neutral).
 */
function handlePermissionResponse(data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
    return;
  }

  dependencies.resolveToolApproval(data.requestId, {
    allow: Boolean(data.allow),
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });
}
async function handleOAuthRequest(
  ws: WebSocket,
  userId: string | number | null,
  messageType: string,
  data: AnyRecord,
  supervisor: OAuthSupervisor,
): Promise<void> {
  const userKey = oauthUserKey(userId);
  const requestedAttemptId = typeof data.attemptId === 'string' ? data.attemptId : '';
  const owner = latestOAuthAttemptOwner;
  if (
    (messageType === 'oauth.submit' || messageType === 'oauth.cancel')
    && (
      owner?.attemptId !== requestedAttemptId
      || owner?.userKey !== userKey
    )
  ) {
    sendJson(ws, { kind: messageType, payload: oauthOwnershipFailure() });
    return;
  }

  let response: unknown;
  switch (messageType) {
    case 'oauth.providers':
      response = await supervisor.oauthProviders();
      break;
    case 'oauth.status': {
      response = await supervisor.oauthStatus();
      const payload = oauthRecord(response);
      const result = oauthRecord(payload?.result);
      const attempt = oauthRecord(result?.attempt);
      const statusOwner = latestOAuthAttemptOwner;
      if (
        attempt
        && (
          statusOwner?.attemptId !== attempt.attemptId
          || statusOwner?.userKey !== userKey
        )
      ) {
        response = {
          ...payload,
          result: {
            ...result,
            attempt: undefined,
          },
        };
      }
      break;
    }
    case 'oauth.start':
      response = await supervisor.oauthStart(typeof data.providerId === 'string' ? data.providerId : '');
      {
        const attemptId = oauthAttemptIdFromResponse(response);
        if (attemptId) latestOAuthAttemptOwner = { attemptId, userKey };
      }
      break;
    case 'oauth.submit':
      response = await supervisor.oauthSubmit(requestedAttemptId, typeof data.value === 'string' ? data.value : '');
      break;
    case 'oauth.cancel':
      response = await supervisor.oauthCancel(requestedAttemptId);
      break;
    default:
      return;
  }

  sendJson(ws, { kind: messageType, payload: response });
}


/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.steer`               { sessionId, content } -> { kind: 'chat_steered', steered, reason }
 * - `chat.abort`               { sessionId }
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `seq`) or a gateway event
 * (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`).
 */
export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const userId = readRequestUserId(request);
  const userKey = oauthUserKey(userId);
  const oauthSupervisor = dependencies.oauthSupervisor;
  const unsubscribeOAuth = oauthSupervisor?.subscribeOAuth((event) => {
    if (event.method === 'oauth.phase') {
      const attemptId = typeof event.payload.attemptId === 'string' ? event.payload.attemptId : '';
      const eventOwner = latestOAuthAttemptOwner;
      if (
        eventOwner?.attemptId !== attemptId
        || eventOwner?.userKey !== userKey
      ) {
        return;
      }
    }
    sendJson(ws, { kind: event.method, payload: event.payload });
  }) ?? (() => {});



  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as AnyRecord;
      const messageType = typeof data.type === 'string' ? data.type : '';
      if (await dependencies.gjcProjection?.handle(ws, data)) {
        return;
      }

      if (messageType.startsWith('oauth.')) {
        if (!OAUTH_MESSAGE_TYPES.has(messageType)) {
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
        }
        if (!oauthSupervisor) {
          sendProtocolError(ws, 'OAUTH_UNAVAILABLE', 'App sign-in is unavailable.');
          return;
        }
        await handleOAuthRequest(ws, userId, messageType, data, oauthSupervisor);
        return;
      }

      switch (messageType) {
        case 'chat.send':
          await handleChatSend(ws, userId, data, dependencies);
          return;
        case 'chat.abort':
          await handleChatAbort(ws, data, dependencies);
          return;
        case 'chat.steer':
          await handleChatSteer(ws, data, dependencies);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies);
          return;
        case 'chat.permission-response':
          handlePermissionResponse(data, dependencies);
          return;
        default:
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      sendProtocolError(ws, 'INTERNAL_ERROR', message);
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    unsubscribeOAuth();
    connectedClients.delete(ws);
  });
}
