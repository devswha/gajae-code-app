import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

export const CUA_SAFE_TOOLS = [
  'start_session',
  'end_session',
  'list_apps',
  'list_windows',
  'get_window_state',
  'get_accessibility_tree',
  'launch_app',
  'set_window_frame',
  'move_cursor',
  'click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'invoke_menu',
] as const;

export type CuaSafeTool = (typeof CUA_SAFE_TOOLS)[number];

export type CuaStatus = {
  installed: boolean;
  version?: string;
  daemon: 'running' | 'stopped' | 'unknown';
  accessibility?: boolean;
  screenRecording?: boolean;
  error?: string;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function executableCandidates(): string[] {
  return [
    process.env.CUA_DRIVER_PATH,
    join(homedir(), '.local', 'bin', 'cua-driver'),
    '/opt/homebrew/bin/cua-driver',
    '/usr/local/bin/cua-driver',
  ].filter((value): value is string => Boolean(value));
}

async function findExecutable(): Promise<string | null> {
  for (const candidate of executableCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the small, explicit set of supported install paths.
    }
  }
  return null;
}

async function runInspection(executable: string, args: string[], timeoutMs = 3_000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let output = '';
    let settled = false;
    const finish = (result: { ok: boolean; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, output: output.trim() });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', () => {
      finish({ ok: false, output: output.trim() });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, output: output.trim() });
    });
  });
}

function permissionValue(output: string, names: string[]): boolean | undefined {
  const line = output.split(/\r?\n/u).find((entry) => names.some((name) => entry.toLowerCase().includes(name)));
  if (!line) return undefined;
  if (/granted|authorized|enabled|yes|true|✅/iu.test(line)) return true;
  if (/denied|not granted|disabled|no|false|❌/iu.test(line)) return false;
  return undefined;
}

export class CuaDriverClient {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private sequence = 0;
  private readonly pending = new Map<string | number, Pending>();

  async status(): Promise<CuaStatus> {
    const executable = await findExecutable();
    if (!executable) return { installed: false, daemon: 'unknown' };
    const [version, daemon, permissions] = await Promise.all([
      runInspection(executable, ['--version']),
      runInspection(executable, ['status']),
      process.platform === 'darwin'
        ? runInspection(executable, ['permissions', 'status'])
        : Promise.resolve({ ok: true, output: '' }),
    ]);
    return {
      installed: true,
      version: version.output.split(/\r?\n/u)[0]?.slice(0, 120),
      daemon: daemon.ok ? 'running' : /not running|stopped|unavailable/iu.test(daemon.output) ? 'stopped' : 'unknown',
      accessibility: permissionValue(permissions.output, ['accessibility']),
      screenRecording: permissionValue(permissions.output, ['screen recording', 'screen capture']),
      ...(!version.ok ? { error: version.output || 'Unable to inspect CUA Driver.' } : {}),
    };
  }

  async call(tool: CuaSafeTool, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!CUA_SAFE_TOOLS.includes(tool)) throw new Error('CUA Driver tool is not allowed.');
    await this.ensureStarted();
    return this.request('tools/call', { name: tool, arguments: args }, 60_000, signal);
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const executable = await findExecutable();
      if (!executable) throw new Error('CUA Driver is not installed.');
      const child = spawn(executable, ['mcp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      this.child = child;
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', (line) => this.handleLine(line));
      child.stderr.on('data', () => {});
      child.on('close', () => this.failAll(new Error('CUA Driver disconnected.')));
      child.on('error', (error) => this.failAll(error));
      await this.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'gajae-code-app', version: '0.1.0' },
      }, 10_000);
      this.notify('notifications/initialized', {});
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const child = this.child;
    if (!child || child.exitCode !== null) return Promise.reject(new Error('CUA Driver is unavailable.'));
    const id = `${++this.sequence}-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CUA Driver request timed out.'));
      }, timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id, reason: 'Client request cancelled.' });
        reject(new Error('CUA Driver request was cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
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
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'CUA Driver request failed.'));
    else pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    this.child = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function isCuaSafeTool(value: unknown): value is CuaSafeTool {
  return typeof value === 'string' && (CUA_SAFE_TOOLS as readonly string[]).includes(value);
}
