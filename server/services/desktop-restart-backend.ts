import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { DESKTOP_RESTART_MAX_BLOCKERS, isRestartControlCommand, isRestartId, type RestartBlocker, type RestartControlCommand, type RestartControlResult } from '../../shared/desktopRestartProtocol.js';
import type { DesktopOwnerActivity } from '../../shared/desktopUpdateProtocol.js';

import { DesktopRestartAuthority } from './desktop-restart-authority.js';

type Attempt = {
  id: string; draftEpoch: number; epoch: string; token?: string; expiresAt?: number;
  prepared?: Promise<RestartControlResult>;
};
type BrowserStatusRefresh = () => Promise<{ ready: boolean }>;

type AuthorityFailure = Extract<Awaited<ReturnType<DesktopRestartAuthority['prepare']>>, { ok: false }>;

/** Owner/code pairs only; the authority's blockers carry nothing else, but the
 * wire shape is fixed here rather than trusting whatever a reader produced. */
function relayBlockers(result: AuthorityFailure): RestartBlocker[] {
  return result.blockers.slice(0, DESKTOP_RESTART_MAX_BLOCKERS).map(({ owner, code }) => ({ owner: owner ?? null, code }));
}

function classifyPrepareFailure(result: AuthorityFailure): string {
  // The shell owner deliberately keeps PTY descendant uncertainty latched for
  // the server lifetime. Preserve the authority's failed prepare while giving
  // the native/UI layers a stable, actionable reason code.
  if (result.blockers.some((blocker) => blocker.owner === 'shell' && blocker.code === 'owner_unknown')) {
    return 'shell_unverified';
  }
  return result.code;
}

/** Consumes ONLY the authenticated native channel's sealed-current-view claim.
 * No HTTP route accepts this controller or its commands. It never installs,
 * signals a process, flushes a draft or invents missing runtime ownership. */
export class DesktopRestartBackend {
  private authority?: DesktopRestartAuthority;
  private nativeEpoch?: string;
  private everBound = false;
  private active?: Attempt;
  private latestDraftEpoch = 0;
  private readonly generation = randomUUID();
  private revision = 0;
  private browserStatusRefresh?: BrowserStatusRefresh;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * Synchronize the browser cache after the native browser fence and before
   * authority.prepare. This hook is deliberately separate from owner reads:
   * restart snapshots remain pure while this explicit preflight may perform
   * one bounded authenticated status request.
   */
  configureBrowserStatusRefresh(refresh?: BrowserStatusRefresh): void {
    this.browserStatusRefresh = refresh;
  }

  readonly draftReader = {
    getGeneration: (): string => `${this.generation}:${this.revision}`,
    read: (): DesktopOwnerActivity => {
      const valid = this.nativeEpoch !== undefined && this.active !== undefined;
      return { owner: 'ui-drafts', generation: this.draftReader.getGeneration(), complete: valid,
        starting: 0, queued: 0, running: 0, settling: 0, approvals: 0, retained: 0,
        unknown: valid ? [] : ['native_draft_not_sealed'] };
    },
  };

  attachAuthority(authority: DesktopRestartAuthority): void {
    if (this.authority && this.authority !== authority) throw new Error('Restart authority is already attached.');
    this.authority = authority;
  }
  bind(nativeEpoch: string): void {
    if (!isRestartId(nativeEpoch) || !this.authority) throw new Error('Invalid native restart binding.');
    if (this.nativeEpoch === nativeEpoch) return;
    if (this.everBound) throw new Error('A retired native restart channel cannot be rebound.');
    this.everBound = true;
    this.nativeEpoch = nativeEpoch;
    this.revision++;
  }
  disconnected(nativeEpoch: string): void {
    if (this.nativeEpoch !== nativeEpoch) return;
    this.nativeEpoch = undefined;
    this.revision++;
    const active = this.active;
    if (active && this.authority?.state !== 'committed') {
      this.authority?.controllerLost(active.epoch);
      this.clear(active);
    }
  }

  async handle(command: RestartControlCommand, nativeEpoch: string): Promise<RestartControlResult> {
    if (!this.authority || nativeEpoch !== this.nativeEpoch) return this.result(false, 'unauthorized');
    if (!isRestartControlCommand(command)) return this.result(false, 'invalid_command');
    this.refresh();
    switch (command.action) {
      case 'status': return this.result(true);
      case 'prepare': return this.prepare(command);
      case 'cancel': {
        const active = this.active;
        if (this.authority.state === 'committed') return this.result(false, 'committed');
        if (!active) return this.result(true);
        if (active.id !== command.attemptId) return this.result(false, 'invalid_attempt');
        this.authority.controllerLost(active.epoch);
        this.clear(active);
        return this.result(true);
      }
      case 'commit': {
        const active = this.active;
        if (!active || active.id !== command.attemptId || !active.token || active.token !== command.token) return this.result(false, 'invalid_token');
        const committed = await this.authority.commit(active.token, active.epoch);
        if (committed.ok) return this.result(true);
        this.clear(active);
        return this.result(false, committed.code, relayBlockers(committed));
      }
    }
  }

  private prepare(command: Extract<RestartControlCommand, { action: 'prepare' }>): Promise<RestartControlResult> {
    const authority = this.authority!;
    if (authority.state === 'committed') return Promise.resolve(this.result(false, 'committed'));
    const current = this.active;
    if (current) {
      if (current.id === command.attemptId && current.draftEpoch === command.draftEpoch && current.prepared) return current.prepared;
      return Promise.resolve(this.result(false, 'in_progress'));
    }
    if (command.draftEpoch <= this.latestDraftEpoch) return Promise.resolve(this.result(false, 'stale_epoch'));
    this.latestDraftEpoch = command.draftEpoch;
    const active: Attempt = { id: command.attemptId, draftEpoch: command.draftEpoch,
      epoch: createHash('sha256').update(JSON.stringify([this.nativeEpoch, command.attemptId, command.draftEpoch])).digest('hex') };
    this.active = active;
    this.revision++;
    const binding = this.nativeEpoch;
    const prepared = this.prepareAfterBrowserRefresh(active, binding, command);
    return prepared;
  }

  private async prepareAfterBrowserRefresh(
    active: Attempt,
    binding: string | undefined,
    command: Extract<RestartControlCommand, { action: 'prepare' }>,
  ): Promise<RestartControlResult> {
    const authority = this.authority!;
    const refreshStarted = this.now();
    if (this.browserStatusRefresh) {
      try {
        const status = await this.browserStatusRefresh();
        if (status.ready !== true) throw new Error('browser_status_unavailable');
      } catch {
        this.clear(active);
        return this.result(false, 'unknown');
      }
      const elapsed = this.now() - refreshStarted;
      if (!Number.isFinite(elapsed) || elapsed >= command.remainingMs) {
        this.clear(active);
        return this.result(false, 'unknown');
      }
    }
    if (this.active !== active || this.nativeEpoch !== binding) return this.result(false, 'cancelled');
    const remainingMs = this.browserStatusRefresh
      ? Math.max(1, Math.floor(command.remainingMs - (this.now() - refreshStarted)))
      : command.remainingMs;
    const prepared = authority.prepare({ attemptId: active.id, epoch: active.epoch, budgetMs: remainingMs }).then((result) => {
      if (this.active !== active || this.nativeEpoch !== binding) return this.result(false, 'cancelled');
      if (!result.ok) {
        const blockers = relayBlockers(result);
        if (process.env.GJC_DESKTOP_UPDATE_PIPE === '1') console.error('[Desktop restart] Preparation deferred:', blockers);
        authority.controllerLost(active.epoch);
        this.clear(active);
        return this.result(false, classifyPrepareFailure(result), blockers);
      }
      active.token = result.token;
      active.expiresAt = result.expiresAt;
      if (authority.state !== 'prepared' || result.expiresAt <= this.now()) {
        authority.controllerLost(active.epoch);
        this.clear(active);
        return this.result(false, 'expired');
      }
      return this.result(true);
    }, () => {
      authority.controllerLost(active.epoch);
      this.clear(active);
      return this.result(false, 'unknown');
    });
    active.prepared = prepared;
    return prepared;
  }

  private refresh(): void {
    const active = this.active;
    if (active?.token && this.authority?.state === 'open') this.clear(active);
  }
  private clear(active: Attempt): void {
    if (this.active !== active) return;
    this.active = undefined;
    this.revision++;
  }
  private result(ok: boolean, error: string | null = null, blockers: readonly RestartBlocker[] = []): RestartControlResult {
    this.refresh();
    const state = this.authority?.state ?? 'open';
    const token = state === 'prepared' ? this.active?.token ?? null : null;
    const expiresInMs = token && this.active?.expiresAt !== undefined ? Math.max(1, Math.min(10_000, Math.floor(this.active.expiresAt - this.now()))) : null;
    return { ok, state, attemptId: this.active?.id ?? null, token, expiresInMs, error, blockers: ok ? [] : blockers };
  }
}
