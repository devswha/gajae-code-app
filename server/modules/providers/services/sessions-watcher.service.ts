import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { GjcSessionWatcher } from '@/modules/providers/services/gjc-session-watcher.service.js';
import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { getGjcLiveSessionRoot } from '@/shared/utils.js';
import { generateDisplayName } from '@/modules/projects/index.js';

type WatcherEventType = 'add' | 'change';

const GJC_WATCH_PATHS = [...new Set([
  path.join(os.homedir(), '.gjc', 'agent', 'sessions'),
  path.resolve(getGjcLiveSessionRoot()),
])];

const PROJECTS_UPDATE_DEBOUNCE_MS = 500;
const PROJECTS_UPDATE_MAX_WAIT_MS = 2_000;

let gjcWatcher: GjcSessionWatcher | null = null;
let gjcWatcherStarting: GjcSessionWatcher | null = null;
const gjcWatcherStartTasks = new Set<Promise<void>>();
const gjcWatcherStartAbortControllers = new Set<AbortController>();
let gjcWatcherRestartTimer: ReturnType<typeof setTimeout> | null = null;
let gjcWatcherRestartDelayMs = 1_000;
let gjcWatcherGeneration = 0;
let sessionWatchersClosing = false;
const GJC_WATCH_RESTART_MAX_MS = 30_000;

type PendingWatcherUpdate = {
  providers: Set<LLMProvider>;
  changeTypes: Set<WatcherEventType>;
  /**
   * Provider-native session ids reported by the synchronizers are grouped by
   * provider so ids shared by different providers remain distinct.
   */
  updatedSessionIdsByProvider: Map<LLMProvider, Set<string>>;
};

let pendingWatcherUpdate: PendingWatcherUpdate | null = null;
let pendingWatcherUpdateStartedAt: number | null = null;
let pendingWatcherFlushTimer: ReturnType<typeof setTimeout> | null = null;
let watcherRefreshInFlight = false;
let watcherRescheduleAfterRefresh = false;

/**
 * Filters watcher events to provider-specific session artifact file types.
 */
function isWatcherTargetFile(filePath: string): boolean {
  return filePath.endsWith('.jsonl');
}

function clearPendingWatcherFlushTimer(): void {
  if (pendingWatcherFlushTimer) {
    clearTimeout(pendingWatcherFlushTimer);
    pendingWatcherFlushTimer = null;
  }
}

function schedulePendingWatcherFlush(): void {
  if (!pendingWatcherUpdate) {
    return;
  }

  const now = Date.now();
  if (pendingWatcherUpdateStartedAt === null) {
    pendingWatcherUpdateStartedAt = now;
  }

  const elapsed = now - pendingWatcherUpdateStartedAt;
  const remainingMaxWait = Math.max(0, PROJECTS_UPDATE_MAX_WAIT_MS - elapsed);
  const delay = Math.min(PROJECTS_UPDATE_DEBOUNCE_MS, remainingMaxWait);

  clearPendingWatcherFlushTimer();
  pendingWatcherFlushTimer = setTimeout(() => {
    void flushPendingWatcherUpdate();
  }, delay);
}

function queuePendingWatcherUpdate(
  eventType: WatcherEventType,
  provider: LLMProvider,
  updatedSessionId: string | null
): void {
  if (!pendingWatcherUpdate) {
    pendingWatcherUpdate = {
      providers: new Set<LLMProvider>(),
      changeTypes: new Set<WatcherEventType>(),
      updatedSessionIdsByProvider: new Map<LLMProvider, Set<string>>(),
    };
  }

  pendingWatcherUpdate.providers.add(provider);
  pendingWatcherUpdate.changeTypes.add(eventType);
  if (updatedSessionId) {
    const updatedSessionIds = pendingWatcherUpdate.updatedSessionIdsByProvider.get(provider);
    if (updatedSessionIds) {
      updatedSessionIds.add(updatedSessionId);
    } else {
      pendingWatcherUpdate.updatedSessionIdsByProvider.set(provider, new Set([updatedSessionId]));
    }
  }

  schedulePendingWatcherFlush();
}

/**
 * Builds one `session_upserted` delta event for a provider-native session id.
 *
 * The event carries everything a sidebar needs to upsert the session in place
 * (session summary plus owning-project metadata), so clients never need a full
 * project-list refetch when a transcript file changes on disk. Returns `null`
 * when the id cannot be resolved to an indexed session row.
 */
async function buildSessionUpsertedEvent(
  provider: LLMProvider,
  updatedProviderSessionId: string
): Promise<string | null> {
  const row = sessionsDb.getSessionByProviderSessionId(provider, updatedProviderSessionId)
    ?? sessionsDb.getSessionById(updatedProviderSessionId);
  if (!row || row.isArchived) {
    return null;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  return JSON.stringify({
    kind: 'session_upserted',
    sessionId: row.session_id,
    provider: row.provider,
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  });
}

async function flushPendingWatcherUpdate(): Promise<void> {
  clearPendingWatcherFlushTimer();

  if (!pendingWatcherUpdate) {
    return;
  }

  if (watcherRefreshInFlight) {
    watcherRescheduleAfterRefresh = true;
    return;
  }

  const queuedUpdate = pendingWatcherUpdate;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = true;

  try {
    // Per-session deltas instead of full project snapshots: an upsert of one
    // session can never clobber unrelated client state, so the frontend needs
    // no "suppress updates while a run is active" protection logic.
    const events: string[] = [];
    for (const [provider, updatedSessionIds] of queuedUpdate.updatedSessionIdsByProvider) {
      for (const updatedSessionId of updatedSessionIds) {
        const event = await buildSessionUpsertedEvent(provider, updatedSessionId);
        if (event) {
          events.push(event);
        }
      }
    }

    if (events.length > 0) {
      connectedClients.forEach(client => {
        if (client.readyState === WS_OPEN_STATE) {
          for (const event of events) {
            client.send(event);
          }
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Session watcher refresh failed while broadcasting session_upserted', { error: message });
  } finally {
    watcherRefreshInFlight = false;

    if (pendingWatcherUpdate || watcherRescheduleAfterRefresh) {
      watcherRescheduleAfterRefresh = false;
      schedulePendingWatcherFlush();
    }
  }
}

/**
 * Handles file watcher updates and triggers provider file-level synchronization.
 */
async function onUpdate(
  eventType: WatcherEventType,
  filePath: string,
  provider: LLMProvider,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  if (!isWatcherTargetFile(filePath)) {
    return;
  }

  try {
    const result = await sessionSynchronizerService.synchronizeProviderFile(
      provider,
      filePath,
      signal
    );
    if (signal?.aborted) {
      return;
    }
    if (!result.indexed) {
      return;
    }

    console.log(`Session synchronization triggered by ${eventType} event for provider "${provider}"`, {
      filePath,
      sessionId: result.sessionId,
    });
    queuePendingWatcherUpdate(eventType, provider, result.sessionId);
  } catch (error) {
    if (signal?.aborted) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Session watcher sync failed for provider "${provider}"`, {
      eventType,
      filePath,
      error: message,
    });
  }
}

function clearGjcWatcherRestartTimer(): void {
  if (!gjcWatcherRestartTimer) return;
  clearTimeout(gjcWatcherRestartTimer);
  gjcWatcherRestartTimer = null;
}

function scheduleGjcWatcherRestart(): void {
  if (sessionWatchersClosing || gjcWatcherRestartTimer) return;
  const delay = gjcWatcherRestartDelayMs;
  gjcWatcherRestartDelayMs = Math.min(gjcWatcherRestartDelayMs * 2, GJC_WATCH_RESTART_MAX_MS);
  gjcWatcherRestartTimer = setTimeout(() => {
    gjcWatcherRestartTimer = null;
    void startGjcSessionWatcher(true);
  }, delay);
  gjcWatcherRestartTimer.unref?.();
}

async function runGjcSessionWatcherStart(
  reconcileAfterStart: boolean,
  controller: AbortController
): Promise<void> {
  const { signal } = controller;
  if (signal.aborted || sessionWatchersClosing || gjcWatcher || gjcWatcherStarting) return;
  try {
    await Promise.all(GJC_WATCH_PATHS.map((rootPath) => (
      fsPromises.mkdir(rootPath, { recursive: true })
    )));
  } catch {
    if (signal.aborted || sessionWatchersClosing) return;
    console.error('Failed to prepare GJC native session watcher roots.');
    scheduleGjcWatcherRestart();
    return;
  }
  if (signal.aborted || sessionWatchersClosing || gjcWatcher || gjcWatcherStarting) return;
  const generation = ++gjcWatcherGeneration;
  let failureReported = false;
  const reportFailure = (): void => {
    if (failureReported || generation !== gjcWatcherGeneration || sessionWatchersClosing) return;
    failureReported = true;
    controller.abort();
    if (gjcWatcher === watcher) gjcWatcher = null;
    console.error('GJC native session watcher failed.');
    void watcher.close()
      .catch(() => {})
      .finally(() => {
        if (gjcWatcherStarting === watcher) gjcWatcherStarting = null;
        scheduleGjcWatcherRestart();
      });
  };

  const watcher = new GjcSessionWatcher({
    roots: GJC_WATCH_PATHS,
    onEvent: (event, signal) => onUpdate(event.kind, event.path, 'gjc', signal),
    onFailure: reportFailure,
    diagnostic: (message) => console.error(message),
  });
  gjcWatcherStarting = watcher;

  try {
    await watcher.start();
    if (
      failureReported
      || sessionWatchersClosing
      || generation !== gjcWatcherGeneration
    ) {
      await watcher.close();
      return;
    }
    if (gjcWatcherStarting === watcher) gjcWatcherStarting = null;
    gjcWatcher = watcher;
    if (reconcileAfterStart) {
      const reconciliation = await sessionSynchronizerService.reconcileProvider('gjc', signal);
      if (
        failureReported
        || sessionWatchersClosing
        || generation !== gjcWatcherGeneration
      ) {
        if (gjcWatcher === watcher) gjcWatcher = null;
        await watcher.close();
        return;
      }
      for (const sessionId of reconciliation.sessionIds) {
        queuePendingWatcherUpdate('change', 'gjc', sessionId);
      }
    }
    if (
      failureReported
      || sessionWatchersClosing
      || generation !== gjcWatcherGeneration
    ) {
      if (gjcWatcher === watcher) gjcWatcher = null;
      await watcher.close();
      return;
    }
    gjcWatcherRestartDelayMs = 1_000;
  } catch {
    reportFailure();
    await watcher.close();
  }
}

function startGjcSessionWatcher(reconcileAfterStart = false): Promise<void> {
  if (sessionWatchersClosing || gjcWatcher || gjcWatcherStarting) {
    return Promise.resolve();
  }
  const controller = new AbortController();
  gjcWatcherStartAbortControllers.add(controller);
  const trackedTask = runGjcSessionWatcherStart(reconcileAfterStart, controller);
  gjcWatcherStartTasks.add(trackedTask);
  void trackedTask.then(
    () => {
      gjcWatcherStartAbortControllers.delete(controller);
      gjcWatcherStartTasks.delete(trackedTask);
    },
    () => {
      gjcWatcherStartAbortControllers.delete(controller);
      gjcWatcherStartTasks.delete(trackedTask);
    }
  );
  return trackedTask;
}

/**
 * Starts provider filesystem watchers and performs initial DB synchronization.
 */
export async function initializeSessionsWatcher(): Promise<void> {
  console.log('Setting up session watchers');
  sessionWatchersClosing = false;

  await startGjcSessionWatcher();

  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', {
    processedByProvider: initialSync.processedByProvider,
    failures: initialSync.failures,
  });

}

/**
 * Stops all active provider session watchers.
 */
export async function closeSessionsWatcher(): Promise<void> {
  sessionWatchersClosing = true;
  gjcWatcherGeneration += 1;
  clearGjcWatcherRestartTimer();
  clearPendingWatcherFlushTimer();
  for (const controller of gjcWatcherStartAbortControllers) {
    controller.abort();
  }
  const startTasks = [...gjcWatcherStartTasks];

  const nativeWatchers = [...new Set(
    [gjcWatcher, gjcWatcherStarting].filter(
      (watcher): watcher is GjcSessionWatcher => watcher !== null
    )
  )];
  gjcWatcher = null;
  gjcWatcherStarting = null;
  await Promise.all([
    ...nativeWatchers.map((watcher) => watcher.close().catch(() => {
      console.error('Failed to close GJC native session watcher.');
    })),
    ...startTasks.map((task) => task.catch(() => {
      console.error('Failed to stop GJC native session watcher startup.');
    })),
  ]);
  gjcWatcherRestartDelayMs = 1_000;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = false;
  watcherRescheduleAfterRefresh = false;
}
