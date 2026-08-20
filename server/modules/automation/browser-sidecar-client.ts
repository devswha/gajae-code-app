import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_PROTOCOL_VERSION,
  BrowserNdjsonDecoder,
  serializeBrowserFrame,
  type BrowserCommand,
  type BrowserEventFrame,
  type BrowserInput,
  type BrowserRequestFrame,
  type BrowserRequestMethod,
  type BrowserResponseFrame,
} from './browser-protocol.js';

type Pending = {
  method: BrowserRequestMethod;
  sessionId?: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type BrowserEventListener = (event: BrowserEventFrame) => void;

const LOG_PATH = join(homedir(), '.gajae-app', 'logs', 'browser-sidecar.log');
const LOG_MAX_BYTES = 4 * 1024 * 1024;

function logDiagnostic(message: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    if ((statSync(LOG_PATH, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX_BYTES) writeFileSync(LOG_PATH, '');
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message.trim()}\n`);
  } catch {
    // Diagnostics never participate in the automation control path.
  }
}

export class BrowserSidecarClient {
  private child?: ChildProcessWithoutNullStreams;
  private decoder = new BrowserNdjsonDecoder();
  private starting?: Promise<void>;
  private shuttingDown = false;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<BrowserEventListener>();

  subscribe(listener: BrowserEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): Promise<unknown> {
    return this.request('status', undefined, {});
  }

  open(sessionId: string, payload: { url?: string; allowDownload?: boolean; waitUntil?: string }): Promise<unknown> {
    return this.request('session.open', sessionId, payload);
  }

  close(sessionId: string): Promise<unknown> {
    return this.request('session.close', sessionId, {});
  }

  command(sessionId: string, command: BrowserCommand, signal?: AbortSignal): Promise<unknown> {
    return this.request('browser.command', sessionId, { command }, command.action === 'run' ? 305_000 : 45_000, signal);
  }

  input(sessionId: string, input: BrowserInput): Promise<unknown> {
    return this.request('browser.input', sessionId, { input }, 10_000);
  }

  subscribeFrames(sessionId: string): Promise<unknown> {
    return this.request('screencast.subscribe', sessionId, {});
  }

  unsubscribeFrames(sessionId: string): Promise<unknown> {
    return this.request('screencast.unsubscribe', sessionId, {});
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const child = this.child;
    if (!child) return;
    try {
      await this.request('shutdown', undefined, {}, 2_000);
    } catch {
      child.kill('SIGKILL');
    }
    this.child = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    if (this.starting) return this.starting;
    if (this.shuttingDown) throw new Error('Browser automation is shutting down.');
    this.starting = (async () => {
      const compiled = !import.meta.url.endsWith('.ts');
      const sidecarPath = fileURLToPath(new URL(compiled ? './browser-sidecar.js' : './browser-sidecar.ts', import.meta.url));
      const bundledBun = fileURLToPath(new URL(compiled ? '../../../../dist-native/bun' : '../../../dist-native/bun', import.meta.url));
      const bunPath = process.env.GAJAE_BROWSER_BUN_PATH
        ?? (existsSync(bundledBun) ? bundledBun : undefined)
        ?? (!compiled && process.env.GAJAE_ALLOW_DEVELOPMENT_BUN === '1' ? 'bun' : undefined);
      if (!bunPath) throw new Error('Bundled Bun runtime is unavailable.');
      const allowedEnv = [
        'HOME', 'PATH', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'LANG', 'LC_ALL',
        'XDG_CACHE_HOME', 'GAJAE_BROWSER_CACHE_DIR', 'GAJAE_BROWSER_PROFILE_DIR', 'GAJAE_BROWSER_EXECUTABLE_PATH',
      ];
      const env = Object.fromEntries(allowedEnv.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
      const child = spawn(bunPath, [sidecarPath], {
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      this.child = child;
      this.decoder = new BrowserNdjsonDecoder();
      child.stdout.on('data', (chunk: Buffer) => this.handleData(child, chunk));
      child.stderr.on('data', (chunk: Buffer) => logDiagnostic(chunk.toString()));
      child.stdin.on('error', (error) => this.fail(child, error));
      child.on('error', (error) => this.fail(child, error));
      child.on('close', () => this.fail(child, new Error('Browser sidecar exited.')));
      await this.requestStarted('initialize', undefined, {}, 10_000);
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async request(
    method: BrowserRequestMethod,
    sessionId: string | undefined,
    payload: Record<string, unknown>,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.ensureStarted();
    return this.requestStarted(method, sessionId, payload, timeoutMs, signal);
  }

  private requestStarted(
    method: BrowserRequestMethod,
    sessionId: string | undefined,
    payload: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const child = this.child;
    if (!child || child.exitCode !== null) return Promise.reject(new Error('Browser sidecar is unavailable.'));
    const id = `browser-${randomUUID()}`;
    const frame: BrowserRequestFrame = {
      protocolVersion: BROWSER_PROTOCOL_VERSION,
      kind: 'request',
      id,
      method,
      ...(sessionId ? { sessionId } : {}),
      payload,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Browser sidecar request timed out.'));
      }, timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Browser request was cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        method,
        ...(sessionId ? { sessionId } : {}),
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        timer,
      });
      child.stdin.write(serializeBrowserFrame(frame));
    });
  }

  private handleData(child: ChildProcessWithoutNullStreams, chunk: Buffer): void {
    if (child !== this.child) return;
    try {
      for (const frame of this.decoder.push(chunk)) {
        if (frame.kind === 'response') this.settle(frame);
        else if (frame.kind === 'event') {
          for (const listener of this.listeners) {
            try { listener(frame); } catch { /* One consumer cannot break the sidecar stream. */ }
          }
        }
      }
    } catch (error) {
      this.fail(child, error instanceof Error ? error : new Error('Invalid browser sidecar output.'));
    }
  }

  private settle(frame: BrowserResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    const responseSessionId = 'sessionId' in frame ? frame.sessionId : undefined;
    if (pending.method !== frame.method || pending.sessionId !== responseSessionId) {
      pending.reject(new Error('Browser sidecar returned a mismatched response.'));
      return;
    }
    if (!frame.ok) pending.reject(new Error(`${frame.error?.code ?? 'browser_error'}: ${frame.error?.message ?? 'Browser operation failed.'}`));
    else pending.resolve(frame.result);
  }

  private fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (child !== this.child) return;
    this.child = undefined;
    logDiagnostic(error.message);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Browser sidecar disconnected.'));
    }
    this.pending.clear();
  }
}
