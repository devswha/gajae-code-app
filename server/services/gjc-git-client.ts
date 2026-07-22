import { randomUUID } from 'node:crypto';
import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_FRAME_BYTES = 64 * 1024;
const MAX_AGGREGATE_BYTES = 16 * 1024 * 1024;
const FAILURE = 'GJC native client is unavailable.';
export class GjcNativeRequestError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'GjcNativeRequestError';
  }
}

type Child = {
  stdin: { write(data: string): boolean; end(): void; on?(event: string, listener: (...args: unknown[]) => void): unknown };
  stdout: { on(event: 'data', listener: (chunk: Buffer | Uint8Array) => void): unknown };
  stderr?: { on(event: 'data', listener: (chunk: Buffer | Uint8Array) => void): unknown };
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'error' | 'exit' | 'close', listener: (...args: unknown[]) => void): unknown;
};
export type GjcNativeSpawn = (command: string, args: string[], options: { detached: false; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean }) => Child;
export type GjcNativeClientOptions = {
  corePath?: string; spawn?: GjcNativeSpawn; platform?: NodeJS.Platform; environment?: NodeJS.ProcessEnv;
  compiled?: boolean; readyTimeoutMs?: number; restartDelayMs?: number; maxRestartDelayMs?: number; aggregateLimitBytes?: number;
  onHealthChange?: (healthy: boolean, generation: number) => void;
};
type Pending = { method: string; resolve(value: unknown): void; reject(error: Error): void; items: unknown[]; chunks: Buffer[]; bytes: number; nextSequence: number };

/** Protocol v1 NDJSON process owner. Failed requests are deliberately never replayed. */
export class GjcNativeClient {
  private readonly options: Required<Pick<GjcNativeClientOptions, 'spawn' | 'platform' | 'environment' | 'readyTimeoutMs' | 'restartDelayMs' | 'maxRestartDelayMs' | 'aggregateLimitBytes'>> & Pick<GjcNativeClientOptions, 'corePath' | 'compiled' | 'onHealthChange'>;
  private child?: Child;
  private generation = 0;
  private input = Buffer.alloc(0);
  private readonly pending = new Map<string, Pending>();
  private starting?: Promise<void>;
  private ready = false;
  private closed = false;
  private restart?: Promise<void>;
  private backoff: number;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;

  constructor(private readonly command: 'git' | 'jobs', options: GjcNativeClientOptions = {}, private readonly launchArgs?: string[]) {
    this.options = { spawn: options.spawn ?? spawnChild as unknown as GjcNativeSpawn, platform: options.platform ?? process.platform, environment: options.environment ?? process.env, readyTimeoutMs: options.readyTimeoutMs ?? 5_000, restartDelayMs: options.restartDelayMs ?? 50, maxRestartDelayMs: options.maxRestartDelayMs ?? 1_000, aggregateLimitBytes: options.aggregateLimitBytes ?? MAX_AGGREGATE_BYTES, corePath: options.corePath, compiled: options.compiled, onHealthChange: options.onHealthChange };
    this.backoff = this.options.restartDelayMs;
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!this.ready || !child) throw new Error(FAILURE);
    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { method, resolve, reject, items: [], chunks: [], bytes: 0, nextSequence: 0 }));
    try {
      child.stdin.write(`${JSON.stringify(this.command === 'git' ? { protocolVersion: 1, kind: 'request', id, method, params } : { ...params, protocolVersion: 1, id, method })}\n`);
    } catch {
      this.rejectPending(id, new Error(FAILURE));
      this.failed(child, this.generation);
    }
    return result;
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error(FAILURE));
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    if (this.restart) return this.restart.then(() => this.start());
    let resolveStart!: () => void;
    let rejectStart!: (error: Error) => void;
    const starting = new Promise<void>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    this.starting = starting;
    this.readyResolve = resolveStart;
    this.readyReject = rejectStart;
    const executable = this.options.platform === 'win32' ? 'gajae-core.exe' : 'gajae-core';
    const compiled = this.options.compiled ?? !import.meta.url.endsWith('.ts');
    const corePath = this.options.corePath ?? fileURLToPath(new URL(compiled ? `../../../dist-native/${executable}` : `../../dist-native/${executable}`, import.meta.url));
    try {
      const args = this.launchArgs ?? (this.command === 'git' ? ['git', '--workdir', process.cwd()] : ['jobs', '--database', '']);
      const child = this.options.spawn(corePath, args, { detached: false, env: this.options.environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const generation = ++this.generation;
      this.child = child;
      this.input = Buffer.alloc(0);
      child.stdout.on('data', (chunk) => this.onData(child, generation, chunk));
      child.stdin.on?.('error', () => this.failed(child, generation));
      child.on('error', () => this.failed(child, generation));
      child.on('exit', () => this.failed(child, generation));
      child.on('close', () => this.failed(child, generation));
      if (this.command === 'jobs') this.probe(child, generation);
      const timer = setTimeout(() => { if (!this.ready) this.failed(child, generation); }, this.options.readyTimeoutMs);
      timer.unref?.();
    } catch {
      this.failed();
    }
    return starting;
  }

  private probe(child: Child, generation: number): void {
    const id = randomUUID();
    this.pending.set(id, { method: 'job.list', resolve: () => {}, reject: () => {}, items: [], chunks: [], bytes: 0, nextSequence: 0 });
    try { child.stdin.write(`${JSON.stringify({ protocolVersion: 1, id, method: 'job.list', limit: 1 })}\n`); } catch { this.failed(child, generation); }
  }

  private onData(child: Child, generation: number, chunk: Buffer | Uint8Array): void {
    if (this.closed || !this.isCurrent(child, generation)) return;
    this.input = Buffer.concat([this.input, Buffer.from(chunk)]);
    while (true) {
      const newline = this.input.indexOf(10); if (newline < 0) break;
      const raw = this.input.subarray(0, newline); this.input = this.input.subarray(newline + 1);
      if (raw.length > MAX_FRAME_BYTES) return this.failed(child, generation);
      let frame: unknown;
      try { frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/\r$/u, '')); } catch { return this.failed(child, generation); }
      this.decode(child, generation, frame);
      if (this.closed || !this.isCurrent(child, generation)) return;
    }
    if (this.input.length > MAX_FRAME_BYTES) this.failed(child, generation);
  }

  private decode(child: Child, generation: number, frame: unknown): void {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return this.failed(child, generation);
    const value = frame as Record<string, unknown>;
    if (value.protocolVersion !== 1) return this.failed(child, generation);
    if (this.command === 'git' && value.kind === 'ready') { if (this.ready) return this.failed(child, generation); this.markReady(child, generation); return; }
    if (typeof value.id !== 'string') return this.failed(child, generation);
    const pending = this.pending.get(value.id); if (!pending) return this.failed(child, generation);
    if (value.kind === 'item' || value.kind === 'chunk') {
      if (!this.ready || !Number.isSafeInteger(value.sequence) || value.sequence !== pending.nextSequence) return this.failed(child, generation);
      let data: Buffer;
      try {
        if (value.kind === 'chunk') {
          if (value.encoding !== 'base64' || typeof value.data !== 'string' || !isBase64(value.data)) return this.failed(child, generation);
          data = Buffer.from(value.data, 'base64');
        } else {
          data = Buffer.from(JSON.stringify(value.item));
        }
      } catch { return this.failed(child, generation); }
      pending.bytes += data.length;
      if (pending.bytes > this.options.aggregateLimitBytes) return this.failed(child, generation);
      pending.nextSequence += 1;
      if (value.kind === 'chunk') pending.chunks.push(data); else pending.items.push(value.item);
      return;
    }
    if (value.kind !== undefined && value.kind !== 'response') return this.failed(child, generation);
    if (this.command === 'git' && value.kind !== 'response') return this.failed(child, generation);
    if (typeof value.ok !== 'boolean') return this.failed(child, generation);
    this.pending.delete(value.id);
    if (value.ok) {
      pending.resolve(this.complete(value.result, pending));
      if (this.command === 'jobs' && !this.ready) this.markReady(child, generation);
    } else {
      const native = value.error as Record<string, unknown> | undefined;
      const code = typeof value.error === 'string'
        ? value.error
        : typeof native?.code === 'string' ? native.code : undefined;
      pending.reject(new GjcNativeRequestError(
        typeof value.error === 'string' ? value.error : code ?? FAILURE,
        code,
      ));
    }
  }

  private complete(result: unknown, pending: Pending): unknown {
    if (this.command !== 'git') return result === undefined ? { items: pending.items, chunks: pending.chunks.length ? Buffer.concat(pending.chunks) : undefined } : result;
    const merged = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : { result };
    if (pending.method === 'diff') return { ...merged, patch: Buffer.concat(pending.chunks) };
    if (pending.items.length || this.isCollectionResult(merged)) return { ...merged, items: pending.items };
    return result;
  }

  private isCollectionResult(result: Record<string, unknown>): boolean { return this.command === 'git' && ('count' in result); }
  private isCurrent(child: Child, generation: number): boolean { return this.child === child && this.generation === generation; }
  private markReady(child: Child, generation: number): void {
    if (!this.isCurrent(child, generation) || this.ready) return;
    this.ready = true;
    this.backoff = this.options.restartDelayMs;
    this.readyResolve?.();
    this.options.onHealthChange?.(true, generation);
  }
  private rejectPending(id: string, error: Error): void { const pending = this.pending.get(id); if (pending) { this.pending.delete(id); pending.reject(error); } }
  private failed(child?: Child, generation?: number): void {
    if (this.closed || this.restart || (child && (generation === undefined || !this.isCurrent(child, generation)))) return;
    const failedChild = child ?? this.child;
    this.ready = false;
    this.readyReject?.(new Error(FAILURE));
    this.options.onHealthChange?.(false, generation ?? this.generation);
    this.starting = undefined;
    for (const [id] of this.pending) this.rejectPending(id, new Error(FAILURE));
    if (failedChild && this.child === failedChild) this.child = undefined;
    this.input = Buffer.alloc(0);
    try {
      failedChild?.kill('SIGKILL');
    } catch {
      // best-effort cleanup
    }
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.options.maxRestartDelayMs);
    const restarting = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      timer.unref?.();
    }).then(() => {
      if (this.closed) throw new Error(FAILURE);
      this.restart = undefined;
      return this.start();
    });
    this.restart = restarting;
    void restarting.catch(() => {});
  }
  close(): void {
    this.closed = true;
    this.readyReject?.(new Error(FAILURE));
    for (const [id] of this.pending) this.rejectPending(id, new Error(FAILURE));
    const child = this.child;
    this.child = undefined;
    try {
      child?.stdin.end();
    } catch {
      // best-effort cleanup
    }
    try {
      child?.kill('SIGKILL');
    } catch {
      // best-effort cleanup
    }
  }
}

function isBase64(value: string): boolean { return value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value); }

export type GjcGitClientOptions = GjcNativeClientOptions & { workdir: string };
export class GjcGitClient extends GjcNativeClient {
  constructor(private readonly gitOptions: GjcGitClientOptions) { super('git', gitOptions, ['git', '--workdir', gitOptions.workdir]); }
  override start(): Promise<void> { return super.start(); }
  create(params: Record<string, unknown>): Promise<unknown> { return this.request('worktree.create', params); }
  list(params: Record<string, unknown> = {}): Promise<unknown> { return this.request('worktree.list', params); }
  status(params: Record<string, unknown> = {}): Promise<unknown> { return this.request('status', params); }
  diff(params: Record<string, unknown> = {}): Promise<unknown> { return this.request('diff', params); }
  prune(params: Record<string, unknown> = {}): Promise<unknown> { return this.request('worktree.prune', params); }
}
