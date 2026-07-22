import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import WebSocket, { type RawData } from 'ws';

const PROTOCOL_VERSION = 3;
const MAX_INBOUND_PAYLOAD_BYTES = 2 * 1024 * 1024;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DISCOVERY_RETRY_MS = 50;
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type GjcSdkFrame = Record<string, unknown> & { type: string };

export interface GjcSdkSessionOptions {
  cwd: string;
  sessionId: string;
  discoveryTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface GjcSdkRequestOptions {
  confirm?: boolean;
  idempotencyKey?: string;
}

export type GjcSdkClientErrorCode =
  | 'closed'
  | 'connection'
  | 'discovery'
  | 'protocol'
  | 'remote'
  | 'timeout';

export class GjcSdkClientError extends Error {
  readonly code: GjcSdkClientErrorCode;

  constructor(code: GjcSdkClientErrorCode, message: string) {
    super(message);
    this.name = 'GjcSdkClientError';
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;

interface DiscoveryRecord {
  url: string;
  token: string;
  sessionId?: string;
}

interface PendingRequest {
  responseType: 'control_response' | 'query_response';
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (reason: GjcSdkClientError) => void;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function sanitizeString(value: string, token: string): string {
  return token ? value.replaceAll(token, '[redacted]') : value;
}

function sanitizeValue(value: unknown, token: string): unknown {
  if (typeof value === 'string') return sanitizeString(value, token);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, token));
  const record = asObject(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      sanitizeString(key, token),
      sanitizeValue(item, token),
    ]),
  );
}

function remoteError(frame: GjcSdkFrame, token: string): GjcSdkClientError {
  const error = asObject(frame.error);
  const message = typeof error?.message === 'string'
    ? sanitizeString(error.message, token)
    : 'GJC SDK request failed.';
  return new GjcSdkClientError('remote', message);
}

function parseDiscovery(value: string, sessionId: string): DiscoveryRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  const record = asObject(parsed);
  if (
    !record
    || typeof record.url !== 'string'
    || typeof record.token !== 'string'
    || record.token.length === 0
    || (record.sessionId !== undefined && record.sessionId !== sessionId)
  ) {
    return null;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(record.url);
  } catch {
    return null;
  }

  const hostname = endpoint.hostname.toLowerCase();
  if (
    endpoint.protocol !== 'ws:'
    || !['127.0.0.1', '[::1]'].includes(hostname)
    || endpoint.username !== ''
    || endpoint.password !== ''
    || endpoint.search !== ''
    || endpoint.hash !== ''
  ) {
    return null;
  }

  return {
    url: endpoint.toString(),
    token: record.token,
    ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
  };
}

async function discoverEndpoint(
  cwd: string,
  sessionId: string,
  timeoutMs: number,
): Promise<DiscoveryRecord | null> {
  const discoveryPath = path.join(cwd, '.gjc', 'state', 'sdk', `${sessionId}.json`);
  const deadline = Date.now() + timeoutMs;

  do {
    try {
      const record = parseDiscovery(await readFile(discoveryPath, 'utf8'), sessionId);
      if (record) return record;
    } catch {
      // A GJC process may publish discovery shortly after its session header.
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(DISCOVERY_RETRY_MS, remaining));
    });
  } while (Date.now() <= deadline);

  return null;
}

function deserializeFrame(data: RawData, isBinary: boolean): GjcSdkFrame | null {
  if (isBinary) return null;
  try {
    const frame = asObject(JSON.parse(data.toString()));
    return frame && typeof frame.type === 'string' ? frame as GjcSdkFrame : null;
  } catch {
    return null;
  }
}

export class GjcSdkClient {
  readonly #socket: WebSocket;
  readonly #token: string;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #listeners = new Set<(frame: GjcSdkFrame) => void>();
  #closed = false;

  private constructor(socket: WebSocket, token: string, requestTimeoutMs: number) {
    this.#socket = socket;
    this.#token = token;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  static async connect(record: DiscoveryRecord, requestTimeoutMs: number): Promise<GjcSdkClient> {
    const endpoint = new URL(record.url);
    endpoint.searchParams.set('token', record.token);
    const socket = new WebSocket(endpoint, { maxPayload: MAX_INBOUND_PAYLOAD_BYTES });
    const client = new GjcSdkClient(socket, record.token, requestTimeoutMs);
    await client.#waitForHello();
    return client;
  }

  onFrame(listener: (frame: GjcSdkFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  control(
    operation: string,
    input: Record<string, unknown> = {},
    options: GjcSdkRequestOptions = {},
  ): Promise<unknown> {
    if (!operation) {
      return Promise.reject(new GjcSdkClientError('protocol', 'Control operation must be non-empty.'));
    }
    return this.#request({
      type: 'control_request',
      operation,
      input,
      ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
    }, options);
  }

  query(query: string, input: Record<string, unknown> = {}, cursor?: string): Promise<unknown> {
    if (!query) {
      return Promise.reject(new GjcSdkClientError('protocol', 'Query must be non-empty.'));
    }
    return this.#request({
      type: 'query_request',
      query,
      input,
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  reply(id: string, answer: unknown): void {
    if (!id) throw new GjcSdkClientError('protocol', 'Action id must be non-empty.');
    this.#send({ type: 'reply', id, answer, token: this.#token });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(new GjcSdkClientError('closed', 'GJC SDK connection closed.'));
    if (this.#socket.readyState === WebSocket.CLOSED) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#socket.terminate();
        resolve();
      }, 250);
      timer.unref?.();
      this.#socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.#socket.close();
    });
  }

  #waitForHello(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishFailure = (error: GjcSdkClientError) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.#closed = true;
        this.#socket.close();
        reject(error);
      };
      const onError = () => finishFailure(
        new GjcSdkClientError('connection', 'GJC SDK connection failed.'),
      );
      const onClose = () => finishFailure(
        new GjcSdkClientError('connection', 'GJC SDK closed before hello.'),
      );
      const onMessage = (data: RawData, isBinary: boolean) => {
        const frame = deserializeFrame(data, isBinary);
        if (
          !frame
          || !['hello', 'server_hello'].includes(frame.type)
          || frame.protocolVersion !== PROTOCOL_VERSION
        ) {
          finishFailure(new GjcSdkClientError(
            'protocol',
            'GJC SDK protocol version 3 hello is required.',
          ));
          return;
        }

        cleanup();
        this.#installHandlers();
        try {
          this.#socket.send(JSON.stringify({
            type: 'hello',
            protocolVersion: PROTOCOL_VERSION,
            capabilities: ['ask_controls_v1'],
          }), (error) => {
            if (error) {
              finishFailure(new GjcSdkClientError(
                'connection',
                'Failed to send GJC SDK client hello.',
              ));
              return;
            }
            if (settled) return;
            settled = true;
            resolve();
          });
        } catch {
          finishFailure(new GjcSdkClientError(
            'connection',
            'Failed to send GJC SDK client hello.',
          ));
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.#socket.off('error', onError);
        this.#socket.off('close', onClose);
        this.#socket.off('message', onMessage);
      };
      const timeout = setTimeout(() => finishFailure(
        new GjcSdkClientError('timeout', 'Timed out waiting for GJC SDK hello.'),
      ), this.#requestTimeoutMs);
      timeout.unref?.();

      this.#socket.once('error', onError);
      this.#socket.once('close', onClose);
      this.#socket.once('message', onMessage);
    });
  }

  #installHandlers(): void {
    this.#socket.on('message', (data, isBinary) => this.#handleMessage(data, isBinary));
    this.#socket.on('error', () => this.#closeWithError(
      new GjcSdkClientError('connection', 'GJC SDK connection failed.'),
    ));
    this.#socket.on('close', () => this.#closeWithError(
      new GjcSdkClientError('closed', 'GJC SDK connection closed.'),
    ));
  }

  #handleMessage(data: RawData, isBinary: boolean): void {
    const frame = deserializeFrame(data, isBinary);
    if (!frame) {
      this.#closeWithError(new GjcSdkClientError(
        'protocol',
        'Received an invalid GJC SDK frame.',
      ));
      return;
    }

    const id = typeof frame.id === 'string' ? frame.id : undefined;
    const isResponse = frame.type === 'control_response' || frame.type === 'query_response';
    if (isResponse && id) {
      const pending = this.#pending.get(id);
      if (pending) {
        if (pending.responseType !== frame.type) {
          this.#closeWithError(new GjcSdkClientError(
            'protocol',
            `Expected ${pending.responseType} for GJC SDK request.`,
          ));
          return;
        }
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        if (frame.ok === false || frame.status === 'error') {
          pending.reject(remoteError(frame, this.#token));
        } else if (frame.result !== undefined) {
          pending.resolve(sanitizeValue(frame.result, this.#token));
        } else if (frame.page !== undefined) {
          pending.resolve(sanitizeValue(frame.page, this.#token));
        } else {
          pending.resolve(sanitizeValue(frame, this.#token));
        }
      }
    }

    this.#emitFrame(frame);
  }

  #emitFrame(frame: GjcSdkFrame): void {
    const safeFrame = sanitizeValue(frame, this.#token) as GjcSdkFrame;
    for (const listener of this.#listeners) {
      try {
        listener(safeFrame);
      } catch {
        // One observer must not block transport settlement or later observers.
      }
    }
  }

  #request(frame: GjcSdkFrame, options: GjcSdkRequestOptions = {}): Promise<unknown> {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new GjcSdkClientError('closed', 'GJC SDK connection is closed.'));
    }

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new GjcSdkClientError('timeout', 'GJC SDK request timed out.'));
      }, this.#requestTimeoutMs);
      timer.unref?.();
      this.#pending.set(id, {
        timer,
        resolve,
        reject,
        responseType: frame.type === 'control_request' ? 'control_response' : 'query_response',
      });

      try {
        this.#send({
          ...frame,
          id,
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  #send(frame: JsonObject): void {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
      throw new GjcSdkClientError('closed', 'GJC SDK connection is closed.');
    }
    try {
      this.#socket.send(JSON.stringify(frame), (error) => {
        if (error) {
          this.#closeWithError(new GjcSdkClientError(
            'connection',
            'Failed to send GJC SDK frame.',
          ));
        }
      });
    } catch {
      throw new GjcSdkClientError('connection', 'Failed to send GJC SDK frame.');
    }
  }

  #closeWithError(error: GjcSdkClientError): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(error);
    this.#emitFrame({ type: 'transport_closed', reason: error.code });
    if (
      this.#socket.readyState === WebSocket.OPEN
      || this.#socket.readyState === WebSocket.CONNECTING
    ) {
      this.#socket.close();
    }
  }

  #rejectPending(error: GjcSdkClientError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export async function connectGjcSdkSession(
  options: GjcSdkSessionOptions,
): Promise<GjcSdkClient | null> {
  if (!SAFE_SESSION_ID.test(options.sessionId)) {
    throw new GjcSdkClientError('discovery', 'GJC SDK session id is unsafe.');
  }

  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isFinite(discoveryTimeoutMs)
    || discoveryTimeoutMs < 0
    || !Number.isFinite(requestTimeoutMs)
    || requestTimeoutMs <= 0
  ) {
    throw new GjcSdkClientError('discovery', 'GJC SDK timeouts are invalid.');
  }

  const discovery = await discoverEndpoint(options.cwd, options.sessionId, discoveryTimeoutMs);
  return discovery ? GjcSdkClient.connect(discovery, requestTimeoutMs) : null;
}
