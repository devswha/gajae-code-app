import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { connect as connectSocket, type Socket } from 'node:net';
import { performance } from 'node:perf_hooks';

import { DesktopNativeInit, isNativeSecret, type DesktopNativeBinding } from '@/shared/desktop-native-init.js';
import type { DesktopWorkAdmission } from '@/shared/interfaces.js';

import { isBuiltinBrowserState, type BuiltinBrowserBinding, type BuiltinBrowserCommand, type BuiltinBrowserState } from '../../../shared/builtinBrowserProtocol.js';
import type { DesktopOwnerActivity } from '../../../shared/desktopUpdateProtocol.js';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_REQUESTS = 8;
const activityKeys = ['owner', 'generation', 'complete', 'starting', 'queued', 'running', 'settling', 'approvals', 'retained', 'unknown'];
const counts = ['starting', 'queued', 'running', 'settling', 'approvals', 'retained'] as const;

function nativeActivity(value: unknown): value is DesktopOwnerActivity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === activityKeys.length && activityKeys.every((key) => Object.hasOwn(record, key))
    && record.owner === 'browser' && typeof record.generation === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(record.generation)
    && typeof record.complete === 'boolean' && counts.every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0)
    && Array.isArray(record.unknown) && record.unknown.length <= 32
    && record.unknown.every((reason) => typeof reason === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(reason));
}

type Options = { initialization?: DesktopNativeInit; connect?: typeof connectSocket; pid?: number };
type Operation = 'status' | 'open' | 'state' | 'command' | 'close';

/** A native controller client: no child process, browser installation, frame stream or input relay. */
export class TauriBrowserClient {
  private initialization?: DesktopNativeInit;
  private binding: DesktopNativeBinding | null = null;
  private unsubscribe: () => void = () => {};
  private readonly connect: typeof connectSocket;
  private readonly pid: number;
  private readonly pending = new Set<Socket>();
  private readonly epoch = randomUUID();
  private revision = 0;
  private native: DesktopOwnerActivity | null = null;
  private ready = false;
  private uncertain = false;
  private admission?: DesktopWorkAdmission;

  constructor(options: Options = {}) {
    this.connect = options.connect ?? connectSocket;
    this.pid = options.pid ?? process.pid;
    if (options.initialization) this.configureInitialization(options.initialization);
  }

  configureInitialization(initialization: DesktopNativeInit): void {
    this.unsubscribe();
    this.initialization = initialization;
    this.unsubscribe = initialization.subscribe((bindings) => {
      const binding = bindings?.browser ?? null;
      if (this.binding === binding) return;
      for (const socket of this.pending) socket.destroy();
      this.binding = binding;
      this.ready = false;
      this.native = null;
      this.revision++;
    });
  }

  configureDesktopRestartAdmission(admission?: DesktopWorkAdmission): void { this.admission = admission; }
  isReady(): boolean { return this.ready && this.binding !== null; }
  getGeneration(): string { return `${this.epoch}:${this.revision}`; }

  async status(): Promise<{ state: 'ready' | 'unavailable'; ready: boolean; engine: 'webview' }> {
    if (!this.binding) return { state: 'unavailable', ready: false, engine: 'webview' };
    try {
      const value = await this.request('status', 'status', {}, undefined, undefined, 2000) as Record<string, unknown>;
      if (!value || value.ready !== true || !nativeActivity(value.activity)) throw new Error('browser_protocol_error');
      if (!this.ready || this.uncertain || JSON.stringify(this.native) !== JSON.stringify(value.activity)) this.revision++;
      this.ready = true;
      this.uncertain = false;
      this.native = value.activity;
      return { state: 'ready', ready: true, engine: 'webview' };
    } catch (error) {
      if (this.ready || !this.uncertain) this.revision++;
      this.ready = false;
      this.uncertain = true;
      throw error;
    }
  }

  async snapshotActivity(): Promise<DesktopOwnerActivity> {
    if (this.binding) await this.status().catch(() => {});
    const expected = this.initialization?.expected === true;
    const unknown = [...new Set([
      ...(this.native?.unknown ?? []),
      ...(expected && (!this.binding || !this.ready || this.uncertain) ? ['builtin_browser_unconfirmed'] : []),
    ])];
    return {
      owner: 'browser', generation: this.getGeneration(), complete: unknown.length === 0 && (this.native?.complete ?? !expected),
      starting: this.native?.starting ?? 0, queued: this.native?.queued ?? 0,
      running: (this.native?.running ?? 0) + this.pending.size, settling: this.native?.settling ?? 0,
      approvals: this.native?.approvals ?? 0, retained: this.native?.retained ?? 0, unknown,
    };
  }

  async open(sessionId: string, payload: { url?: string }, signal?: AbortSignal): Promise<BuiltinBrowserState> {
    const value = await this.request('open', sessionId, payload, undefined, signal);
    if (!isBuiltinBrowserState(value, sessionId)) throw new Error('browser_protocol_error');
    return value;
  }

  async state(sessionId: string, signal?: AbortSignal): Promise<BuiltinBrowserState> {
    const value = await this.request('state', sessionId, {}, undefined, signal);
    if (!isBuiltinBrowserState(value, sessionId)) throw new Error('browser_protocol_error');
    return value;
  }

  command(sessionId: string, command: BuiltinBrowserCommand, expected: BuiltinBrowserBinding, signal?: AbortSignal): Promise<unknown> {
    return this.request('command', sessionId, { command }, expected, signal);
  }

  close(sessionId: string, signal?: AbortSignal): Promise<unknown> {
    if (!this.binding) return Promise.resolve({ closed: false });
    return this.request('close', sessionId, {}, undefined, signal, 2500);
  }

  async shutdown(): Promise<void> {
    this.unsubscribe();
    for (const socket of this.pending) socket.destroy();
    this.binding = null;
    this.ready = false;
    this.revision++;
  }

  private request(operation: Operation, sessionId: string, payload: Record<string, unknown>, expected?: BuiltinBrowserBinding, signal?: AbortSignal, timeoutMs = 30_000): Promise<unknown> {
    const binding = this.binding;
    if (!binding) return Promise.reject(new Error('builtin_browser_unavailable'));
    if (signal?.aborted) return Promise.reject(new Error('browser_cancelled'));
    if (this.pending.size >= MAX_REQUESTS) return Promise.reject(new Error('browser_busy'));
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sessionId)) return Promise.reject(new Error('browser_invalid_session'));
    const release = operation === 'status' || operation === 'state' ? undefined : this.admission?.enter(`browser.${operation}`);
    const id = randomUUID();
    const nonce = randomBytes(32).toString('hex');
    const deadline = performance.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      let socket: Socket | undefined;
      let buffer = Buffer.alloc(0);
      let received = 0;
      let phase: 'proof' | 'result' = 'proof';
      let settled = false;
      const finish = (error?: string, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (socket) { this.pending.delete(socket); socket.destroy(); }
        if (operation !== 'status') this.revision++;
        buffer.fill(0);
        release?.();
        if (error) reject(new Error(error)); else resolve(result);
      };
      const abort = () => finish('browser_cancelled');
      const timer = setTimeout(() => finish('browser_timeout'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      try { socket = this.connect(binding.socket); }
      catch { finish('builtin_browser_unavailable'); return; }
      const channel = socket;
      this.pending.add(channel);
      if (operation !== 'status') this.revision++;
      channel.once('connect', () => {
        if (settled) return;
        if (this.binding !== binding) { finish('browser_binding_changed'); return; }
        // The path can be replaced by a same-UID process. Prove native identity before disclosing a secret or command.
        channel.write(`${JSON.stringify({ protocolVersion: 1, kind: 'challenge', epoch: binding.epoch, pid: this.pid, nonce })}\n`);
      });
      channel.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (this.binding !== binding || performance.now() >= deadline) { finish('browser_timeout'); return; }
        received += chunk.length;
        if (received > MAX_FRAME_BYTES) { finish('browser_protocol_error'); return; }
        buffer = Buffer.concat([buffer, chunk]);
        const newline = buffer.indexOf(10);
        if (newline < 0) return;
        try {
          if (newline !== buffer.length - 1) throw new Error();
          const frame = JSON.parse(buffer.subarray(0, newline).toString('utf8')) as Record<string, unknown>;
          if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error();
          if (phase === 'proof') {
            const proof = createHmac('sha256', binding.secret).update(`gajae-native-browser-v1\0${binding.epoch}\0${nonce}`).digest();
            if (Object.keys(frame).length !== 5 || frame.protocolVersion !== 1 || frame.kind !== 'challenge'
              || frame.epoch !== binding.epoch || frame.nonce !== nonce || !isNativeSecret(frame.proof)
              || !timingSafeEqual(proof, Buffer.from(frame.proof, 'hex'))) { finish('browser_unauthorized'); return; }
            phase = 'result';
            buffer.fill(0);
            buffer = Buffer.alloc(0);
            const request = JSON.stringify({ protocolVersion: 1, secret: binding.secret, epoch: binding.epoch,
              pid: this.pid, id, sessionId, operation, payload, timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
              ...(expected ? { expected } : {}),
            });
            if (Buffer.byteLength(request) + 1 > MAX_FRAME_BYTES) { finish('browser_request_too_large'); return; }
            channel.write(`${request}\n`);
            return;
          }
          if (frame.protocolVersion !== 1 || frame.id !== id || frame.epoch !== binding.epoch || frame.sessionId !== sessionId) throw new Error();
          if (frame.ok === true && Object.hasOwn(frame, 'result')) finish(undefined, frame.result);
          else if (frame.ok === false && typeof frame.error === 'string' && /^[a-z_]{1,64}$/u.test(frame.error)) finish(frame.error);
          else throw new Error();
        } catch { finish('browser_protocol_error'); }
      });
      channel.once('error', () => finish('builtin_browser_unavailable'));
      channel.once('close', () => finish('browser_disconnected'));
    });
  }
}
