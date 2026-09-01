import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { generateMessageId } from '@/shared/utils.js';
import type { LLMProvider, NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';

type ChatRunStatus = 'running' | 'completed';
type ChatRun = {
  appSessionId: string; provider: LLMProvider; providerSessionId: string | null;
  status: ChatRunStatus; lastSeq: number; events: NormalizedMessage[];
  writer: ChatSessionWriter; startedAt: number; completedAt: number | null;
};
type AppSessionId = string;
type RunCompletion = { exitCode: number; aborted?: boolean };

type StartRunInput = {
  appSessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  connection: RealtimeClientConnection;
  userId: string | number | null;
};

const completedRunLifetime = 5 * 60 * 1000;
const eventBufferLimit = 5000;
const runsByAppSession = new Map<string, ChatRun>();

function scheduleCompletedRunRemoval(sessionId: string): void {
  const timer = setTimeout(() => {
    const completedRun = runsByAppSession.get(sessionId);
    if (completedRun?.status === 'completed') runsByAppSession.delete(sessionId);
  }, completedRunLifetime);
  void timer.unref?.();
}

function decorateRunEvent(run: ChatRun, event: NormalizedMessage): NormalizedMessage | null {
  if (run.status === 'completed' && event.kind === 'complete') return null;

  const sequence = ++run.lastSeq;
  const publishedEvent: NormalizedMessage = {
    ...event,
    id: event.id || generateMessageId(event.kind),
    timestamp: event.timestamp || new Date().toISOString(),
    sessionId: run.appSessionId,
    seq: sequence,
  };

  if (event.kind === 'complete') {
    publishedEvent.actualSessionId = run.appSessionId;
    Object.assign(run, { status: 'completed' as ChatRunStatus, completedAt: Date.now() });
    scheduleCompletedRunRemoval(run.appSessionId);
  }

  run.events.push(publishedEvent);
  if (run.events.length > eventBufferLimit) run.events.splice(0, run.events.length - eventBufferLimit);
  return publishedEvent;
}

async function broadcastSessionUpsert(sessionId: string): Promise<void> {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session || session.isArchived) return;

  const projectPath = session.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const fallbackName = path.basename(projectPath ?? '') || (projectPath ?? '');
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(fallbackName, projectPath);
  const payload = JSON.stringify({
    kind: 'session_upserted',
    sessionId: session.session_id,
    providerSessionId: session.provider_session_id,
    provider: session.provider,
    session: {
      id: session.session_id,
      summary: session.custom_name || '',
      messageCount: 0,
      lastActivity: session.updated_at ?? session.created_at ?? new Date().toISOString(),
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
    if (client.readyState === WS_OPEN_STATE) client.send(payload);
  }
}

function persistProviderSessionId(run: ChatRun, providerSessionId: string): void {
  if (!providerSessionId || providerSessionId === run.providerSessionId) return;
  run.providerSessionId = providerSessionId;
  const context = { appSessionId: run.appSessionId, providerSessionId };
  const report = (label: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(label, { ...context, error: message });
  };

  try {
    sessionsDb.assignProviderSessionId(run.appSessionId, run.provider, providerSessionId);
    void broadcastSessionUpsert(run.appSessionId).catch((error) => {
      report('[ChatRunRegistry] Failed to broadcast canonical session mapping', error);
    });
  } catch (error) {
    report('[ChatRunRegistry] Failed to persist provider session id mapping', error);
  }
}

function createRun(input: StartRunInput): ChatRun {
  const run = {
    appSessionId: input.appSessionId,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    status: 'running' as ChatRunStatus,
    lastSeq: 0,
    events: [],
    writer: null as unknown as ChatSessionWriter,
    startedAt: Date.now(),
    completedAt: null,
  } satisfies ChatRun;

  run.writer = new ChatSessionWriter({
    appSessionId: input.appSessionId,
    connection: input.connection,
    userId: input.userId,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    onProviderSessionId: (providerSessionId) => persistProviderSessionId(run, providerSessionId),
    decorateOutboundEvent: (event) => decorateRunEvent(run, event),
  });
  return run;
}

function isCurrentRunningRun(run: ChatRun): boolean {
  return run.status === 'running' && runsByAppSession.get(run.appSessionId) === run;
}

export const chatRunRegistry = {
  startRun(input: StartRunInput): ChatRun | null {
    const currentRun = runsByAppSession.get(input.appSessionId);
    if (currentRun?.status === 'running') return null;

    const run = createRun(input);
    runsByAppSession.set(input.appSessionId, run);
    return run;
  },

  getRun(appSessionId: AppSessionId): ChatRun | undefined {
    return runsByAppSession.get(appSessionId);
  },

  isProcessing(appSessionId: AppSessionId): boolean {
    return runsByAppSession.get(appSessionId)?.status === 'running';
  },

  listRunningRuns(): Array<{ sessionId: string; provider: LLMProvider; startedAt: number; lastSeq: number }> {
    const activeRuns: Array<{ sessionId: string; provider: LLMProvider; startedAt: number; lastSeq: number }> = [];
    for (const run of runsByAppSession.values()) {
      if (run.status !== 'running') continue;
      activeRuns.push({ sessionId: run.appSessionId, provider: run.provider, startedAt: run.startedAt, lastSeq: run.lastSeq });
    }
    return activeRuns;
  },

  attachConnection(appSessionId: AppSessionId, connection: RealtimeClientConnection): boolean {
    const run = runsByAppSession.get(appSessionId);
    if (!run) return false;
    run.writer.updateWebSocket(connection);
    return true;
  },

  replayEvents(appSessionId: AppSessionId, afterSeq: number): NormalizedMessage[] {
    const run = runsByAppSession.get(appSessionId);
    if (!run) return [];
    return run.events.filter((event) => typeof event.seq === 'number' && event.seq > afterSeq);
  },

  completeRun(appSessionId: AppSessionId, opts: RunCompletion): void {
    const run = runsByAppSession.get(appSessionId);
    if (run?.status === 'running') run.writer.sendComplete(opts);
  },

  completeRunIfCurrent(run: ChatRun, opts: RunCompletion): void {
    if (isCurrentRunningRun(run)) run.writer.sendComplete(opts);
  },

  clearAll(): void {
    runsByAppSession.clear();
  },
};
