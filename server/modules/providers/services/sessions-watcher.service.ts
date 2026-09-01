import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { GjcSessionWatcher } from '@/modules/providers/services/gjc-session-watcher.service.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { getGjcLiveSessionRoot } from '@/shared/utils.js';

type WatcherEventType = 'add' | 'change';
type PendingWatcherUpdate = { providers: Set<LLMProvider>; changeTypes: Set<WatcherEventType>; updatedSessionIdsByProvider: Map<LLMProvider, Set<string>> };

const watcherRoots = [...new Set([path.join(os.homedir(), '.gjc', 'agent', 'sessions'), path.resolve(getGjcLiveSessionRoot())])];
const debounceMs = 500;
const maxDelayMs = 2_000;
const maxRestartMs = 30_000;

let activeWatcher: GjcSessionWatcher | null = null;
let openingWatcher: GjcSessionWatcher | null = null;
let isClosing = false;
let watcherEpoch = 0;
let restartDelay = 1_000;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
const startingTasks = new Set<Promise<void>>();
const startControllers = new Set<AbortController>();
let queued: PendingWatcherUpdate | null = null;
let queuedSince: number | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushRunning = false;
let flushAgain = false;

function clearTimer(timer: 'restart' | 'flush'): void {
  if (timer === 'restart') {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  } else {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function enqueue(kind: WatcherEventType, provider: LLMProvider, sessionId: string | null): void {
  if (!queued) queued = { providers: new Set(), changeTypes: new Set(), updatedSessionIdsByProvider: new Map() };
  queued.providers.add(provider);
  queued.changeTypes.add(kind);
  if (sessionId) {
    const ids = queued.updatedSessionIdsByProvider.get(provider) ?? new Set<string>();
    ids.add(sessionId);
    queued.updatedSessionIdsByProvider.set(provider, ids);
  }
  armFlush();
}

function armFlush(): void {
  if (!queued) return;
  const now = Date.now();
  queuedSince ??= now;
  const wait = Math.min(debounceMs, Math.max(0, maxDelayMs - (now - queuedSince)));
  clearTimer('flush');
  flushTimer = setTimeout(() => { void deliverQueuedUpdates(); }, wait);
}

async function sessionFrame(provider: LLMProvider, providerSessionId: string): Promise<string | null> {
  const row = sessionsDb.getSessionByProviderSessionId(provider, providerSessionId) ?? sessionsDb.getSessionById(providerSessionId);
  if (!row || row.isArchived) return null;
  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);
  return JSON.stringify({
    kind: 'session_upserted',
    sessionId: row.session_id,
    provider: row.provider,
    session: { id: row.session_id, summary: row.custom_name || '', messageCount: 0, lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString() },
    project: project ? { projectId: project.project_id, path: project.project_path, fullPath: project.project_path, displayName, isStarred: Boolean(project.isStarred) } : null,
    timestamp: new Date().toISOString(),
  });
}

async function deliverQueuedUpdates(): Promise<void> {
  clearTimer('flush');
  if (!queued) return;
  if (flushRunning) {
    flushAgain = true;
    return;
  }
  const batch = queued;
  queued = null;
  queuedSince = null;
  flushRunning = true;
  try {
    const frames: string[] = [];
    for (const [provider, ids] of batch.updatedSessionIdsByProvider) {
      for (const id of ids) {
        const frame = await sessionFrame(provider, id);
        if (frame) frames.push(frame);
      }
    }
    if (frames.length) {
      connectedClients.forEach((client) => {
        if (client.readyState === WS_OPEN_STATE) frames.forEach((frame) => client.send(frame));
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Session watcher refresh failed while broadcasting session_upserted', { error: message });
  } finally {
    flushRunning = false;
    if (queued || flushAgain) {
      flushAgain = false;
      armFlush();
    }
  }
}

async function synchronizeFile(kind: WatcherEventType, filePath: string, provider: LLMProvider, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || !filePath.endsWith('.jsonl')) return;
  try {
    const outcome = await sessionSynchronizerService.synchronizeProviderFile(provider, filePath, signal);
    if (signal?.aborted || !outcome.indexed) return;
    console.log(`Session synchronization triggered by ${kind} event for provider "${provider}"`, { filePath, sessionId: outcome.sessionId });
    enqueue(kind, provider, outcome.sessionId);
  } catch (error) {
    if (signal?.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Session watcher sync failed for provider "${provider}"`, { eventType: kind, filePath, error: message });
  }
}

function scheduleRestart(): void {
  if (isClosing || restartTimer) return;
  const delay = restartDelay;
  restartDelay = Math.min(restartDelay * 2, maxRestartMs);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startGjcSessionWatcher(true);
  }, delay);
  restartTimer.unref?.();
}

async function openGjcWatcher(reconcile: boolean, controller: AbortController): Promise<void> {
  const { signal } = controller;
  if (signal.aborted || isClosing || activeWatcher || openingWatcher) return;
  try {
    await Promise.all(watcherRoots.map((root) => fs.mkdir(root, { recursive: true })));
  } catch {
    if (!signal.aborted && !isClosing) {
      console.error('Failed to prepare GJC native session watcher roots.');
      scheduleRestart();
    }
    return;
  }
  if (signal.aborted || isClosing || activeWatcher || openingWatcher) return;
  const epoch = ++watcherEpoch;
  let reported = false;
  const slot: { current: GjcSessionWatcher | null } = { current: null };
  const failed = (): void => {
    if (reported || epoch !== watcherEpoch || isClosing) return;
    reported = true;
    controller.abort();
    const watcher = slot.current;
    if (activeWatcher === watcher) activeWatcher = null;
    console.error('GJC native session watcher failed.');
    void watcher?.close().catch(() => {}).finally(() => {
      if (openingWatcher === watcher) openingWatcher = null;
      scheduleRestart();
    });
  };
  slot.current = new GjcSessionWatcher({
    roots: watcherRoots,
    onEvent: (event, eventSignal) => synchronizeFile(event.kind, event.path, 'gjc', eventSignal),
    onFailure: failed,
    diagnostic: (message) => console.error(message),
  });
  const watcher = slot.current;
  openingWatcher = watcher;
  try {
    await watcher.start();
    if (reported || isClosing || epoch !== watcherEpoch) {
      await watcher.close();
      return;
    }
    if (openingWatcher === watcher) openingWatcher = null;
    activeWatcher = watcher;
    if (reconcile) {
      const result = await sessionSynchronizerService.reconcileProvider('gjc', signal);
      if (reported || isClosing || epoch !== watcherEpoch) {
        if (activeWatcher === watcher) activeWatcher = null;
        await watcher.close();
        return;
      }
      result.sessionIds.forEach((sessionId) => enqueue('change', 'gjc', sessionId));
    }
    if (reported || isClosing || epoch !== watcherEpoch) {
      if (activeWatcher === watcher) activeWatcher = null;
      await watcher.close();
      return;
    }
    restartDelay = 1_000;
  } catch {
    failed();
    await watcher.close();
  }
}

function startGjcSessionWatcher(reconcile = false): Promise<void> {
  if (isClosing || activeWatcher || openingWatcher) return Promise.resolve();
  const controller = new AbortController();
  startControllers.add(controller);
  const task = openGjcWatcher(reconcile, controller);
  startingTasks.add(task);
  void task.then(
    () => { startControllers.delete(controller); startingTasks.delete(task); },
    () => { startControllers.delete(controller); startingTasks.delete(task); },
  );
  return task;
}

export async function initializeSessionsWatcher(): Promise<void> {
  console.log('Setting up session watchers');
  isClosing = false;
  await startGjcSessionWatcher();
  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', { processedByProvider: initialSync.processedByProvider, failures: initialSync.failures });
}

export async function closeSessionsWatcher(): Promise<void> {
  isClosing = true;
  watcherEpoch += 1;
  clearTimer('restart');
  clearTimer('flush');
  startControllers.forEach((controller) => controller.abort());
  const tasks = [...startingTasks];
  const watchers = [...new Set([activeWatcher, openingWatcher].filter((watcher): watcher is GjcSessionWatcher => watcher !== null))];
  activeWatcher = null;
  openingWatcher = null;
  await Promise.all([
    ...watchers.map((watcher) => watcher.close().catch(() => { console.error('Failed to close GJC native session watcher.'); })),
    ...tasks.map((task) => task.catch(() => { console.error('Failed to stop GJC native session watcher startup.'); })),
  ]);
  restartDelay = 1_000;
  queued = null;
  queuedSince = null;
  flushRunning = false;
  flushAgain = false;
}
