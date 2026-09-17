/**
 * The app's ego browser activity surface: an opt-in setting plus the bounded
 * reader that answers it.
 *
 * Reading executes the user-installed `ego-browser` CLI, which until now only
 * the explicit Settings "Test connection" action was allowed to do. The rules
 * that make a repeated read acceptable live here and in `gjc-ego-activity.ts`:
 * the setting is off by default, nothing runs unless the session's own backend
 * is ego, the script is a fixed read-only constant, one execution is shared by
 * every caller inside a short window, and any failure hides the surface
 * instead of surfacing an error into a coding session.
 */

import {
  EMPTY_EGO_ACTIVITY,
  egoActivityToken,
  isEgoSupportedPlatform,
  probeEgoBrowserCli,
  readEgoActivity,
  readEgoFrame,
  selectEgoActivitySpaces,
  type EgoActivityPage,
  type EgoActivitySnapshot,
  type EgoFrame,
  type GjcBrowserBackend,
} from '@/gjc-engine.js';
import { appConfigDb } from '@/modules/database/index.js';

import { browserBackendStore, type BrowserBackendStore } from './browser-backend.js';

const CONFIG_KEY = 'automation.egoActivity.v1';
const FRAME_CONFIG_KEY = 'automation.egoActivityFrame.v1';

/** One execution serves every session that asks inside this window. */
const SNAPSHOT_TTL_MS = 1_000;
/** Frames are per page and change constantly; they get their own, shorter window. */
const FRAME_TTL_MS = 900;

/**
 * Opt-in, off by default: this renders a logged-in personal browser.
 *
 * The picture is a second, separate switch on purpose. An address is a line of
 * text the user can read past; a frame of the page is whatever happens to be on
 * screen in a signed-in profile, so agreeing to one is not agreeing to the
 * other.
 */
export class EgoActivityStore {
  constructor(private readonly storage: Pick<typeof appConfigDb, 'get' | 'set'> = appConfigDb) {}

  get(): boolean {
    return this.storage.get(CONFIG_KEY) === '1';
  }

  set(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Ego browser activity must be true or false.');
    this.storage.set(CONFIG_KEY, value ? '1' : '0');
    return value;
  }

  frames(): boolean {
    return this.storage.get(FRAME_CONFIG_KEY) === '1';
  }

  setFrames(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Ego browser frames must be true or false.');
    this.storage.set(FRAME_CONFIG_KEY, value ? '1' : '0');
    return value;
  }
}

export const egoActivityStore = new EgoActivityStore();

export type EgoActivityResponse = Readonly<{
  /** The stored opt-in itself, independent of the current backend. */
  configured: boolean;
  /** The surface is live for this session: opted in, supported, and the backend is ego. */
  enabled: boolean;
  backend: GjcBrowserBackend;
  /** ego lite is a macOS-only integration; elsewhere the surface is never offered. */
  supported: boolean;
  /** The stored frame opt-in. */
  framesConfigured: boolean;
  /** Frames are live for this session: the activity surface is on and frames are opted in too. */
  frames: boolean;
  spaces: readonly Readonly<{ id: number; name: string; pages: readonly EgoActivityPage[] }>[];
  /** The CLI could not be read; show nothing rather than a stale or invented state. */
  unavailable?: true;
}>;

type EgoActivityReaderDeps = {
  store?: Pick<EgoActivityStore, 'get' | 'frames'>;
  backend?: Pick<BrowserBackendStore, 'get'>;
  probe?: typeof probeEgoBrowserCli;
  read?: typeof readEgoActivity;
  frame?: typeof readEgoFrame;
  platform?: NodeJS.Platform;
  now?: () => number;
};

export class EgoActivityReader {
  private readonly store: Pick<EgoActivityStore, 'get' | 'frames'>;
  private readonly backend: Pick<BrowserBackendStore, 'get'>;
  private readonly probe: typeof probeEgoBrowserCli;
  private readonly read: typeof readEgoActivity;
  private readonly frameReader: typeof readEgoFrame;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private cached?: { at: number; snapshot: EgoActivitySnapshot };
  private inFlight?: Promise<EgoActivitySnapshot>;
  private cachedFrame?: { at: number; key: string; frame: EgoFrame | undefined };

  constructor(deps: EgoActivityReaderDeps = {}) {
    this.store = deps.store ?? egoActivityStore;
    this.backend = deps.backend ?? browserBackendStore;
    this.probe = deps.probe ?? probeEgoBrowserCli;
    this.read = deps.read ?? readEgoActivity;
    this.frameReader = deps.frame ?? readEgoFrame;
    this.platform = deps.platform ?? process.platform;
    this.now = deps.now ?? Date.now;
  }

  /**
   * The state of the surface for one app session. Nothing is executed when the
   * surface is off, and nothing is executed at all without a session id, so
   * Settings can read the opt-in without touching the CLI.
   */
  async snapshot(appSessionId?: string): Promise<EgoActivityResponse> {
    const backend = this.backend.get();
    const supported = isEgoSupportedPlatform(this.platform);
    const configured = this.store.get();
    const framesConfigured = this.store.frames();
    const enabled = supported && backend === 'ego' && configured;
    const frames = enabled && framesConfigured;
    const off = { configured, framesConfigured, enabled, frames, backend, supported, spaces: [] };
    if (!enabled || !appSessionId) return off;

    const found = this.probe();
    if (!found.ok) return { ...off, unavailable: true };

    const snapshot = await this.observe(found.path);
    const spaces = selectEgoActivitySpaces(snapshot, egoActivityToken(appSessionId))
      .map((space) => ({ id: space.id, name: space.name, pages: space.pages }));
    return {
      ...off,
      spaces,
      ...(snapshot.unavailable ? { unavailable: true as const } : {}),
    };
  }

  /**
   * One frame of a page this session is driving.
   *
   * The picture is gated twice over: the activity surface has to be live, the
   * frame opt-in has to be on, and the requested space and page must appear in
   * this session's own attributed snapshot. A page the session did not open,
   * or a space another session minted, never reaches the capture.
   */
  async frame(appSessionId: string, spaceId: number, label: string): Promise<EgoFrame | undefined> {
    const state = await this.snapshot(appSessionId);
    if (!state.frames) return undefined;
    const space = state.spaces.find((candidate) => candidate.id === spaceId);
    if (!space || !space.pages.some((page) => page.label === label)) return undefined;

    const found = this.probe();
    if (!found.ok) return undefined;

    const key = `${spaceId}:${label}`;
    const now = this.now();
    if (this.cachedFrame && this.cachedFrame.key === key && now - this.cachedFrame.at < FRAME_TTL_MS) {
      return this.cachedFrame.frame;
    }
    const frame = await this.frameReader({ cliPath: found.path, spaceId, label, env: process.env })
      .catch(() => undefined);
    this.cachedFrame = { at: this.now(), key, frame };
    return frame;
  }

  /** Cache and single-flight: concurrent sessions never multiply CLI processes. */
  private observe(cliPath: string): Promise<EgoActivitySnapshot> {
    const now = this.now();
    if (this.cached && now - this.cached.at < SNAPSHOT_TTL_MS) return Promise.resolve(this.cached.snapshot);
    if (this.inFlight) return this.inFlight;
    const pending = this.read({ cliPath, env: process.env })
      .catch((): EgoActivitySnapshot => ({ ...EMPTY_EGO_ACTIVITY, unavailable: true }))
      .then((snapshot) => {
        this.cached = { at: this.now(), snapshot };
        return snapshot;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    this.inFlight = pending;
    return pending;
  }
}

export const egoActivityReader = new EgoActivityReader();
