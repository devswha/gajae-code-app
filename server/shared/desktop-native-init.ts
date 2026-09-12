import type { Readable } from 'node:stream';

export type DesktopNativeBinding = { protocolVersion: 1; socket: string; secret: string; epoch: string };
export type DesktopNativeBindings = { browser: DesktopNativeBinding | null; update: DesktopNativeBinding | null };
export const isNativeSecret = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

const MAX_INIT_BYTES = 4096;
const PREFIX = 'GJC_DESKTOP_INIT ';
const LEGACY_PREFIX = 'GJC_DESKTOP_UPDATE_INIT ';

function binding(value: unknown): value is DesktopNativeBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 4 && item.protocolVersion === 1
    && typeof item.socket === 'string' && item.socket.startsWith('/') && item.socket.length <= 1024
    && !item.socket.includes('\0') && isNativeSecret(item.secret) && isNativeSecret(item.epoch);
}

export type DesktopNativeInitOptions = { input?: Readable; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform };

/** The sole reader of the supervisor's fresh stdin. Secrets never enter worker env or HTTP. */
export class DesktopNativeInit {
  private readonly input: Readable;
  private buffer = Buffer.alloc(0);
  private value: DesktopNativeBindings | null = null;
  private readonly listeners = new Set<(bindings: DesktopNativeBindings | null) => void>();
  private retired = false;
  readonly expected: boolean;

  constructor(options: DesktopNativeInitOptions = {}) {
    this.input = options.input ?? process.stdin;
    const env = options.env ?? process.env;
    this.expected = (options.platform ?? process.platform) === 'darwin' && env.GJC_DESKTOP === '1'
      && (env.GJC_DESKTOP_PIPE === '1' || env.GJC_DESKTOP_UPDATE_PIPE === '1');
    if (!this.expected) { this.retired = true; return; }
    this.input.on('data', this.onData);
    this.input.once('end', this.onEnd);
    this.input.once('error', this.onEnd);
  }

  getBindings(): DesktopNativeBindings | null { return this.value; }
  isRetired(): boolean { return this.retired; }

  subscribe(listener: (bindings: DesktopNativeBindings | null) => void): () => void {
    if (this.retired) { listener(null); return () => {}; }
    this.listeners.add(listener);
    listener(this.value);
    return () => { this.listeners.delete(listener); };
  }

  private readonly onEnd = () => { this.retire(); };
  private readonly onData = (chunk: Buffer | string) => {
    if (this.retired) return;
    if (this.value || this.buffer.length + Buffer.byteLength(chunk) > MAX_INIT_BYTES) { this.retire(); return; }
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const newline = this.buffer.indexOf(10);
    if (newline < 0) return;
    try {
      if (newline !== this.buffer.length - 1) throw new Error();
      const line = this.buffer.toString('utf8', 0, newline);
      if (line.startsWith(PREFIX)) {
        const value = JSON.parse(line.slice(PREFIX.length)) as Record<string, unknown>;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
          || value.protocolVersion !== 2 || !binding(value.browser) || (value.update !== null && !binding(value.update))) throw new Error();
        this.value = { browser: value.browser, update: value.update as DesktopNativeBinding | null };
      } else if (line.startsWith(LEGACY_PREFIX)) {
        const value: unknown = JSON.parse(line.slice(LEGACY_PREFIX.length));
        if (!binding(value)) throw new Error();
        this.value = { browser: null, update: value };
      } else throw new Error();
      this.buffer.fill(0);
      this.buffer = Buffer.alloc(0);
      for (const listener of this.listeners) listener(this.value);
    } catch { this.retire(); }
  };

  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.value = null;
    this.buffer.fill(0);
    this.buffer = Buffer.alloc(0);
    this.input.off('data', this.onData);
    this.input.off('end', this.onEnd);
    this.input.off('error', this.onEnd);
    for (const listener of this.listeners) listener(null);
    this.listeners.clear();
  }
}
