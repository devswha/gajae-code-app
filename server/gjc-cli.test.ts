import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  abortGjcProcess,
  abortGjcSession,
  buildPromptArg,
  registerGjcProcessAlias,
  spawnGjcWithRuntime,
} from './gjc-cli.js';

type TestGjcProcess = {
  aborted?: boolean;
  pid?: number;
  gjcDetachedProcessGroup?: boolean;
  abortPending?: boolean;
  gjcAbortEscalationTimer?: NodeJS.Timeout;
  gjcAbortPromise?: Promise<boolean> | null;
  gjcSdkBridge?: { abort(): Promise<boolean> };
  gjcSdkAbortTimeoutMs?: number;
  kill(signal?: string): boolean;
};

test('buildPromptArg: every prompt is a private temp file reference', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gjc-args-test-'));
  try {
    const message = 'Reply with exactly one word: PONG';
    const result = buildPromptArg(message, dir);

    assert.ok(result.tempFile, 'tempFile must be set for every prompt');
    assert.equal(result.arg, `@${result.tempFile}`);
    assert.ok(result.tempFile.startsWith(dir), 'temp file lives in the given dir');
    assert.ok(existsSync(result.tempFile), 'temp file is created on disk');
    assert.equal(readFileSync(result.tempFile, 'utf8'), message, 'file content is the verbatim prompt');
    assert.equal(statSync(result.tempFile).mode & 0o777, 0o600, 'temp file is owner-readable only');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPromptArg: nullish and empty prompts are private temp file references', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gjc-args-test-'));
  try {
    for (const message of [undefined, '']) {
      const result = buildPromptArg(message, dir);

      assert.ok(result.tempFile, 'tempFile must be set for every prompt');
      assert.equal(result.arg, `@${result.tempFile}`);
      assert.equal(readFileSync(result.tempFile, 'utf8'), '');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPromptArg: rejects prompts over 10 MB', () => {
  const oversizedPrompt = 'x'.repeat((10 * 1024 * 1024) + 1);

  assert.throws(
    () => buildPromptArg(oversizedPrompt),
    /gjc prompt exceeds the 10485760-byte limit/,
  );
});

test('registerGjcProcessAlias: spawn handle remains abortable after provider header alias', () => {
  const processes = new Map();
  const child = {};

  registerGjcProcessAlias(processes, 'run-handle', child);
  registerGjcProcessAlias(processes, 'provider-session-id', child);

  assert.equal(processes.get('run-handle'), child, 'abort can still use the pre-header run handle');
  assert.equal(processes.get('provider-session-id'), child, 'abort can use the provider session id');
});

test('abortGjcProcess prefers SDK turn.abort without sending a legacy signal', async () => {
  const signals: string[] = [];
  let sdkAbortCalls = 0;
  const child: TestGjcProcess = {
    gjcSdkBridge: {
      async abort() {
        sdkAbortCalls += 1;
        return true;
      },
    },
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.equal(sdkAbortCalls, 1);
  assert.deepEqual(signals, []);
  assert.equal(child.aborted, true);
  clearTimeout(child.gjcAbortEscalationTimer);
});

test('abortGjcProcess preserves SIGTERM fallback when SDK abort is unavailable', async () => {
  const signals: string[] = [];
  const child: TestGjcProcess = {
    gjcSdkBridge: {
      async abort() {
        return false;
      },
    },
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(child.aborted, true);
  clearTimeout(child.gjcAbortEscalationTimer);
});

test('abortGjcProcess falls back to SIGTERM when SDK abort rejects', async () => {
  const signals: string[] = [];
  const child: TestGjcProcess = {
    gjcSdkBridge: {
      async abort() {
        throw new Error('SDK connection closed');
      },
    },
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.deepEqual(signals, ['SIGTERM']);
  clearTimeout(child.gjcAbortEscalationTimer);
});

test('abortGjcProcess time-bounds a stuck SDK before signal fallback', async () => {
  const signals: string[] = [];
  const child: TestGjcProcess = {
    gjcSdkAbortTimeoutMs: 5,
    gjcSdkBridge: {
      async abort() {
        return new Promise<boolean>(() => {});
      },
    },
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.deepEqual(signals, ['SIGTERM']);
  clearTimeout(child.gjcAbortEscalationTimer);
});

test('abortGjcProcess keeps the legacy signal path when no SDK bridge attached', async () => {
  const signals: string[] = [];
  const child: TestGjcProcess = {
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.deepEqual(signals, ['SIGTERM']);
  clearTimeout(child.gjcAbortEscalationTimer);
});
test('abortGjcProcess signals a non-detached worker child directly', async () => {
  const signals: string[] = [];
  const child: TestGjcProcess = {
    pid: 12345,
    gjcDetachedProcessGroup: false,
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.deepEqual(signals, ['SIGTERM']);
  clearTimeout(child.gjcAbortEscalationTimer);
});
test('abortGjcProcess treats an already-closed child as successfully stopped', async () => {
  const signals: string[] = [];
  const child: TestGjcProcess & { hasClosed: boolean } = {
    hasClosed: true,
    gjcSdkBridge: {
      async abort() {
        return false;
      },
    },
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(await abortGjcProcess(child), true);
  assert.deepEqual(signals, []);
  assert.equal(child.aborted, true);
  assert.equal(child.abortPending, false);
  assert.equal(child.gjcAbortEscalationTimer, undefined);
});

test('abortGjcProcess resets pending state when both SDK and signal abort fail', async () => {
  const child: TestGjcProcess = {
    gjcSdkBridge: {
      async abort() {
        return false;
      },
    },
    kill() {
      return false;
    },
  };

  assert.equal(await abortGjcProcess(child), false);
  assert.equal(child.abortPending, false);
  assert.equal(child.aborted, undefined);
});

test('abortGjcProcess shares one pending SDK abort result across concurrent callers', async () => {
  let resolveAbort!: (value: boolean) => void;
  const sdkResult = new Promise<boolean>((resolve) => {
    resolveAbort = resolve;
  });
  let sdkAbortCalls = 0;
  const child: TestGjcProcess = {
    gjcSdkBridge: {
      abort() {
        sdkAbortCalls += 1;
        return sdkResult;
      },
    },
    kill() {
      return false;
    },
  };

  const first = abortGjcProcess(child);
  const second = abortGjcProcess(child);
  assert.equal(first, second);
  assert.equal(sdkAbortCalls, 1);

  resolveAbort(false);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(child.abortPending, false);
  assert.equal(child.gjcAbortPromise, null);
});
type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { end(): void };
  pid: number;
  kill(signal?: string): boolean;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end() {} });
  child.pid = 4_321;
  child.kill = () => true;
  return child;
}

function createWriter() {
  const messages: Record<string, unknown>[] = [];
  const sessionIds: string[] = [];
  return {
    messages,
    sessionIds,
    send(message: Record<string, unknown>) {
      messages.push(message);
    },
    setSessionId(sessionId: string) {
      sessionIds.push(sessionId);
    },
  };
}

test('spawnGjcWithRuntime parses split CRLF NDJSON and emits normalized deltas only', async () => {
  const child = createFakeChild();
  const writer = createWriter();
  let args: string[] = [];
  let providerChecks = 0;
  const run = spawnGjcWithRuntime('private prompt', { sessionId: 'resume-id' }, writer, {
    spawn(_command: string, receivedArgs: string[]) {
      args = receivedArgs;
      return child;
    },
    attachSdkBridge: async () => {
      throw new Error('optional SDK unavailable');
    },
    isProviderInstalled: async () => {
      providerChecks += 1;
      return true;
    },
    notifyRunFailed() {
      throw new Error('failure notification should not run');
    },
    notifyRunStopped() {},
  });
  assert.equal(run.processId, 4_321);

  const promptArg = args.at(-1)!;
  assert.deepEqual(args.slice(0, 6), ['-p', '--mode', 'json', '--session-dir', args[4], '-r']);
  assert.equal(args[6], 'resume-id');
  assert.ok(existsSync(promptArg.slice(1)));

  child.stdout.emit('data', '{"type":"session","id":"provider-id"}\r');
  child.stdout.emit('data', '\n{"type":"message_update","message":{"role":"assistant","content":"Hel');
  child.stdout.emit('data', 'lo"}}\n{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello world"},{"type":"thinking","thinking":"reason"},{"type":"toolCall","id":"tool-1","name":"Read","input":{"path":"a"}}]}}\r\n');
  child.stdout.emit('data', '{"type":"turn_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"reason"},{"type":"toolCall","id":"tool-1","name":"Read","input":{"path":"a"}},{"type":"toolResult","toolCallId":"tool-1","output":"ok"}]}}\n');
  child.stdout.emit('data', '{"type":"message_end","message":{"role":"toolResult","toolCallId":"tool-1","content":"ok"}}\n');
  child.stdout.emit('data', '{"type":"agent_end","messages":[{"role":"assistant","stopReason":"error","errorMessage":"broken","errorStatus":2}]}\n');
  child.stdout.emit('data', '{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"broken","errorStatus":2}}');
  child.emit('close', 0);
  await run;

  assert.equal(existsSync(promptArg.slice(1)), false, 'prompt file is cleaned after close');
  assert.deepEqual(writer.sessionIds, ['provider-id']);
  assert.deepEqual(
    writer.messages.filter((message) => message.kind === 'stream_delta').map((message) => message.content),
    ['Hello', ' world'],
  );
  assert.equal(writer.messages.filter((message) => message.kind === 'thinking').length, 1);
  assert.equal(writer.messages.filter((message) => message.kind === 'tool_use').length, 1);
  assert.equal(writer.messages.filter((message) => message.kind === 'tool_result').length, 1);
  assert.equal(writer.messages.filter((message) => message.kind === 'error').length, 1);
  assert.equal(writer.messages.filter((message) => message.kind === 'complete').length, 1);
  assert.equal(providerChecks, 0);
});

test('spawnGjcWithRuntime emits bounded SDK usage before terminal complete', async () => {
  const child = createFakeChild();
  const writer = createWriter();
  let markUsageStarted!: () => void;
  let finishUsage!: () => void;
  const usageStarted = new Promise<void>((resolve) => {
    markUsageStarted = resolve;
  });
  let attachCalls = 0;
  const run = spawnGjcWithRuntime('prompt', {}, writer, {
    spawn() {
      return child;
    },
    attachSdkBridge: async ({ writer: bridgeWriter }: { writer: typeof writer }) => {
      attachCalls += 1;
      return {
        async abort() {
          return false;
        },
        close() {
          return new Promise<void>(() => {});
        },
        emitTokenBudget() {
          markUsageStarted();
          return new Promise<void>((resolve) => {
            finishUsage = () => {
              bridgeWriter.send({ kind: 'status', text: 'token_budget' });
              resolve();
            };
          });
        },
      };
    },
    isProviderInstalled: async () => true,
    notifyRunFailed() {},
    notifyRunStopped() {},
    sdkBridgeCloseGraceMs: 5,
  });

  child.stdout.emit('data', '{"type":"session","id":"provider-id"}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attachCalls, 1);
  assert.deepEqual(writer.sessionIds, ['provider-id']);
  child.stdout.emit('data', '{"type":"agent_end","messages":[]}\n');
  const didStartUsage = await Promise.race([
    usageStarted.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  assert.equal(didStartUsage, true);
  child.emit('close', 0);
  finishUsage();
  await run;

  assert.deepEqual(
    writer.messages.slice(-2).map((message) => message.kind),
    ['status', 'complete'],
  );
});

test('spawnGjcWithRuntime emits one complete across error/close races without production callbacks', async () => {
  const child = createFakeChild();
  const writer = createWriter();
  let providerChecks = 0;
  let failedNotifications = 0;
  const run = spawnGjcWithRuntime('prompt', {}, writer, {
    spawn() {
      return child;
    },
    attachSdkBridge: async () => null,
    isProviderInstalled: async () => {
      providerChecks += 1;
      return false;
    },
    notifyRunFailed() {
      failedNotifications += 1;
    },
    notifyRunStopped() {},
  });
  const settled = run.catch(() => {});
  child.emit('error', new Error('spawn failed'));
  child.emit('close', 127);
  await settled;

  assert.equal(writer.messages.filter((message) => message.kind === 'complete').length, 1);
  assert.equal(providerChecks, 1);
  assert.equal(failedNotifications, 1);
  assert.deepEqual(writer.messages.slice(-2).map((message) => message.kind), ['error', 'complete']);
});

test('spawnGjcWithRuntime bounds a stalled provider installation probe', async () => {
  const child = createFakeChild();
  const writer = createWriter();
  const run = spawnGjcWithRuntime('prompt', {}, writer, {
    spawn() {
      return child;
    },
    attachSdkBridge: async () => null,
    isProviderInstalled: async () => new Promise<boolean>(() => {}),
    providerProbeGraceMs: 5,
    notifyRunFailed() {},
    notifyRunStopped() {},
  });

  child.emit('close', 127);
  await assert.rejects(run, /exited with code 127/);
  assert.equal(writer.messages.at(-1)?.kind, 'complete');
});

test('spawnGjcWithRuntime skips complete when an SDK abort is pending during close', async () => {
  const child = createFakeChild();
  const writer = createWriter();
  let resolveAbort!: (value: boolean) => void;
  const pendingAbort = new Promise<boolean>((resolve) => {
    resolveAbort = resolve;
  });
  const run = spawnGjcWithRuntime('prompt', {}, writer, {
    spawn() {
      return child;
    },
    attachSdkBridge: async () => ({ abort: () => pendingAbort, close: async () => {} }),
    isProviderInstalled: async () => true,
    notifyRunFailed() {},
    notifyRunStopped() {},
  });
  child.stdout.emit('data', '{"type":"session","id":"provider-id"}\n');
  await Promise.resolve();
  await Promise.resolve();

  const abort = abortGjcSession(run.abortHandle);
  child.emit('close', 1);
  await run.catch(() => {});
  assert.equal(writer.messages.filter((message) => message.kind === 'complete').length, 0);

  resolveAbort(false);
  await abort;
});
