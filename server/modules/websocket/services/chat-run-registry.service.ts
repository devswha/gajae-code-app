import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { generateMessageId } from '@/shared/utils.js';
import type { LLMProvider, NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';

type ChatRunStatus = 'running' | 'completed';
type ChatRun = {
  appSessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  status: ChatRunStatus;
  lastSeq: number;
  events: NormalizedMessage[];
  writer: ChatSessionWriter;
  startedAt: number;
  completedAt: number | null;
};

type StartRunInput = {
  appSessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  connection: RealtimeClientConnection;
  userId: string | number | null;
};

const completedRunLifetime = 5 * 60 * 1000;
const eventBufferLimit = 5000;
const runBySession = new Map<string, ChatRun>();

async function announceSession(sessionId: string): Promise<void> {
  const stored = sessionsDb.getSessionById(sessionId);
  if (!stored || stored.isArchived) return;

  const projectPath = stored.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const fallbackName = path.basename(projectPath ?? '') || (projectPath ?? '');
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(fallbackName, projectPath);
  const frame = JSON.stringify({
    kind: 'session_upserted',
    sessionId: stored.session_id,
    providerSessionId: stored.provider_session_id,
    provider: stored.provider,
    session: {
      id: stored.session_id,
      summary: stored.custom_name || '',
      messageCount: 0,
      lastActivity: stored.updated_at ?? stored.created_at ?? new Date().toISOString(),
    },
    project: project && {
      projectId: project.project_id,
      path: project.project_path,
      fullPath: project.project_path,
      displayName,
      isStarred: Boolean(project.isStarred),
    },
    timestamp: new Date().toISOString(),
  });

  for (const client of connectedClients) {
    if (client.readyState === WS_OPEN_STATE) client.send(frame);
  }
}

function removeCompletedRunEventually(sessionId: string): void {
  const cleanup = setTimeout(() => {
    if (runBySession.get(sessionId)?.status === 'completed') runBySession.delete(sessionId);
  }, completedRunLifetime);
  cleanup.unref?.();
}

function rememberEvent(run: ChatRun, event: NormalizedMessage): NormalizedMessage | null {
  if (event.kind === 'complete' && run.status === 'completed') return null;

  const sequence = run.lastSeq + 1;
  run.lastSeq = sequence;
  const outbound: NormalizedMessage = {
    ...event,
    id: event.id || generateMessageId(event.kind),
    timestamp: event.timestamp || new Date().toISOString(),
    sessionId: run.appSessionId,
    seq: sequence,
  };

  if (event.kind === 'complete') {
    outbound.actualSessionId = run.appSessionId;
    run.status = 'completed';
    run.completedAt = Date.now();
    removeCompletedRunEventually(run.appSessionId);
  }

  run.events.push(outbound);
  const excess = run.events.length - eventBufferLimit;
  if (excess > 0) run.events.splice(0, excess);
  return outbound;
}

function saveProviderSessionId(run: ChatRun, providerSessionId: string): void {
  if (!providerSessionId || providerSessionId === run.providerSessionId) return;
  run.providerSessionId = providerSessionId;

  try {
    sessionsDb.assignProviderSessionId(run.appSessionId, run.provider, providerSessionId);
    void announceSession(run.appSessionId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ChatRunRegistry] Failed to broadcast canonical session mapping', {
        appSessionId: run.appSessionId,
        providerSessionId,
        error: message,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ChatRunRegistry] Failed to persist provider session id mapping', {
      appSessionId: run.appSessionId,
      providerSessionId,
      error: message,
    });
  }
}

function makeRun(input: StartRunInput): ChatRun {
  const run: ChatRun = {
    appSessionId: input.appSessionId,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    status: 'running',
    lastSeq: 0,
    events: [],
    writer: null as unknown as ChatSessionWriter,
    startedAt: Date.now(),
    completedAt: null,
  };
  run.writer = new ChatSessionWriter({
    appSessionId: input.appSessionId,
    connection: input.connection,
    userId: input.userId,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    onProviderSessionId: (id) => saveProviderSessionId(run, id),
    decorateOutboundEvent: (event) => rememberEvent(run, event),
  });
  return run;
}

function isCurrentRunningRun(run: ChatRun): boolean {
  return runBySession.get(run.appSessionId) === run && run.status === 'running';
}

export const chatRunRegistry = {
  startRun(input: StartRunInput): ChatRun | null {
    if (runBySession.get(input.appSessionId)?.status === 'running') return null;
    const run = makeRun(input);
    runBySession.set(input.appSessionId, run);
    return run;
  },

  getRun(appSessionId: string): ChatRun | undefined {
    return runBySession.get(appSessionId);
  },

  isProcessing(appSessionId: string): boolean {
    return runBySession.get(appSessionId)?.status === 'running';
  },

  listRunningRuns(): Array<{ sessionId: string; provider: LLMProvider; startedAt: number; lastSeq: number }> {
    const active: Array<{ sessionId: string; provider: LLMProvider; startedAt: number; lastSeq: number }> = [];
    for (const run of runBySession.values()) {
      if (run.status === 'running') active.push({ sessionId: run.appSessionId, provider: run.provider, startedAt: run.startedAt, lastSeq: run.lastSeq });
    }
    return active;
  },

  attachConnection(appSessionId: string, connection: RealtimeClientConnection): boolean {
    const run = runBySession.get(appSessionId);
    if (!run) return false;
    run.writer.updateWebSocket(connection);
    return true;
  },

  replayEvents(appSessionId: string, afterSeq: number): NormalizedMessage[] {
    const run = runBySession.get(appSessionId);
    return run ? run.events.filter((event) => typeof event.seq === 'number' && event.seq > afterSeq) : [];
  },

  completeRun(appSessionId: string, opts: { exitCode: number; aborted?: boolean }): void {
    const run = runBySession.get(appSessionId);
    if (run?.status === 'running') run.writer.sendComplete(opts);
  },

  completeRunIfCurrent(run: ChatRun, opts: { exitCode: number; aborted?: boolean }): void {
    if (isCurrentRunningRun(run)) run.writer.sendComplete(opts);
  },

  clearAll(): void {
    runBySession.clear();
  },
};
