import { randomBytes } from 'node:crypto';
import { connect as connectSocket, type Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';

import { DesktopNativeInit } from '../shared/desktop-native-init.js';
import { isDesktopNativeCommand, isDesktopNativeReply, type DesktopNativeCommand, type DesktopNativeReply } from '../../shared/desktopRestartProtocol.js';

import { DesktopRestartChannel, type DesktopRestartHandler } from './desktop-restart-channel.js';
import { authenticNativeChallenge, isNativeSecret, type DesktopNativeBinding } from './desktop-update-transport.js';

const MAX_RESPONSE_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 2_000;
const MAX_PENDING = 4;
type Binding = DesktopNativeBinding;
type Options = {
  initialization?: DesktopNativeInit;
  input?: Readable;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pid?: number;
  connect?: typeof connectSocket;
  restart?: DesktopRestartHandler;
};

/** A relay, not an updater: no downloads, lifecycle, installer or private key APIs. */
export class DesktopUpdateRelay {
  private binding: Binding | null = null;
  private readonly pending = new Set<Socket>();
  private sequence = 0;
  private retired = false;
  private readonly pid: number;
  private readonly connect: typeof connectSocket;
  private readonly initialization: DesktopNativeInit;
  private readonly ownsInitialization: boolean;
  private unsubscribeInitialization: () => void = () => {};
  private readonly restart?: DesktopRestartHandler;
  private restartChannel?: DesktopRestartChannel;

  constructor(options: Options = {}) {
    this.connect = options.connect ?? connectSocket;
    this.pid = options.pid ?? process.pid;
    this.restart = options.restart;
    this.ownsInitialization = !options.initialization;
    this.initialization = options.initialization ?? new DesktopNativeInit(options);
    this.unsubscribeInitialization = this.initialization.subscribe((bindings) => {
      if (this.retired) return;
      if (this.initialization.isRetired()) { this.retire(); return; }
      const next = bindings?.update ?? null;
      if (this.binding === next) return;
      this.binding = next;
      if (next && this.restart) this.restartChannel = new DesktopRestartChannel({ binding: next, pid: this.pid, handler: this.restart, connect: this.connect });
    });
  }

  isAvailable(): boolean { return !this.retired && this.binding !== null; }

  retire(): void {
    this.retired = true;
    this.restartChannel?.close();
    this.binding = null;
    this.unsubscribeInitialization();
    if (this.ownsInitialization) this.initialization.retire();
    for (const socket of this.pending) socket.destroy();
  }

  request(command: DesktopNativeCommand, view: string, origin: string): Promise<DesktopNativeReply> {
    const binding = this.binding;
    if (this.retired || !binding || !isDesktopNativeCommand(command)) return Promise.reject(new Error('updater_unavailable'));
    if (!isNativeSecret(view) || typeof origin !== 'string'
      || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin)) return Promise.reject(new Error('updater_unauthorized'));
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error('updater_busy'));
    const sequence = ++this.sequence;
    const acceptedCommand: DesktopNativeCommand = { ...command };
    const timeoutMs = command.action === 'restartPrepared' ? 20_000 : command.action === 'restartCancel' ? 10_000 : REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      let bytes = Buffer.alloc(0);
      let receivedBytes = 0;
      let phase: 'connecting' | 'challenge' | 'response' = 'connecting';
      let nonce = '';
      let socket: Socket | undefined;
      const deadline = performance.now() + timeoutMs;
      const finish = (error?: string, value?: DesktopNativeReply) => {
        if (settled) return;
        if (!error && performance.now() >= deadline) error = 'updater_timeout';
        settled = true;
        clearTimeout(timer);
        if (socket) {
          this.pending.delete(socket);
          socket.destroy();
        }
        bytes.fill(0);
        if (error) reject(new Error(error));
        else resolve(value!);
      };
      // One deadline covers connect, proof verification AND the command reply.
      // Neither authentication nor partial data renews the budget.
      const timer = setTimeout(() => finish('updater_timeout'), timeoutMs);
      try { socket = this.connect(binding.socket); }
      catch { finish('updater_unavailable'); return; }
      const connectedSocket = socket;
      this.pending.add(socket);
      socket.once('connect', () => {
        if (settled) return;
        if (performance.now() >= deadline) { finish('updater_timeout'); return; }
        if (this.retired || this.binding !== binding) { finish('updater_unavailable'); return; }
        try {
          nonce = randomBytes(32).toString('hex');
          phase = 'challenge';
          // A replaceable same-UID socket path is not native identity. Disclose
          // no secret, view, origin or command until this endpoint proves it.
          connectedSocket.write(`${JSON.stringify({ protocolVersion: 1, kind: 'challenge', epoch: binding.epoch, pid: this.pid, nonce })}\n`);
        } catch { finish('updater_unavailable'); }
      });
      socket.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (performance.now() >= deadline) { finish('updater_timeout'); return; }
        // Bound the entire two-frame exchange before allocating a concatenation.
        if (receivedBytes + chunk.length > MAX_RESPONSE_BYTES) { finish('updater_protocol_error'); return; }
        receivedBytes += chunk.length;
        bytes = Buffer.concat([bytes, chunk]);
        const newline = bytes.indexOf(10);
        if (newline === -1) return;
        try {
          if (newline !== bytes.length - 1) throw new Error();
          const response: unknown = JSON.parse(bytes.subarray(0, newline).toString('utf8'));
          if (!response || typeof response !== 'object' || Array.isArray(response)
            || this.retired || this.binding !== binding) throw new Error();
          const frame = response as Record<string, unknown>;
          if (phase === 'challenge') {
            if (!authenticNativeChallenge(frame, binding, nonce)) { finish('updater_unauthorized'); return; }
            if (performance.now() >= deadline) { finish('updater_timeout'); return; }
            bytes.fill(0);
            bytes = Buffer.alloc(0);
            phase = 'response';
            // Keep this authenticated descriptor; reconnecting would discard
            // the endpoint proof. Native separately enforces LOCAL_PEERPID.
            connectedSocket.write(`${JSON.stringify({ protocolVersion: 1, secret: binding.secret, epoch: binding.epoch, pid: this.pid, sequence, view, origin, command: acceptedCommand })}\n`);
            return;
          }
          if (phase !== 'response' || frame.protocolVersion !== 1 || frame.sequence !== sequence) throw new Error();
          if (frame.ok === true && isDesktopNativeReply(frame.snapshot)) {
            const reply = frame.snapshot;
            if ('kind' in reply) {
              if (reply.kind === 'restartChallenge' ? acceptedCommand.action !== 'restart'
                : !('attemptId' in acceptedCommand) || reply.attemptId !== acceptedCommand.attemptId || reply.draftEpoch !== acceptedCommand.draftEpoch) throw new Error();
            }
            finish(undefined, reply);
          }
          else if (frame.ok === false && typeof frame.error === 'string' && /^[a-z_]{1,64}$/.test(frame.error)) finish(frame.error);
          else throw new Error();
        } catch { finish('updater_protocol_error'); }
      });
      socket.once('error', () => finish('updater_unavailable'));
      socket.once('close', () => finish('updater_unavailable'));
    });
  }
}
