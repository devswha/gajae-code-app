import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const executable = process.platform === 'win32' ? 'gajae-core.exe' : 'gajae-core';
const corePath = fileURLToPath(new URL(`../dist-native/${executable}`, import.meta.url));
const WATCHER_FRAME_TIMEOUT_MS = 60_000;
const WATCHER_PROCESS_TIMEOUT_MS = 90_000;
const WATCHER_FRAME_POLL_INTERVAL_MS = 10;

type CoreResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
};

function runCore(
  args: string[],
  chunks: Buffer[] = [],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CoreResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(corePath, args, {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('gajae-core test timed out.'));
    }, 5_000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {
      // Some tests intentionally make the proxied child close stdin early.
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    for (const chunk of chunks) child.stdin.write(chunk);
    child.stdin.end();
  });
}

test('native core reports its pinned binary identity', async () => {
  const result = await runCore(['--version']);

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout.toString('utf8'), /^gajae-core 0\.2\.0\n$/u);
  assert.equal(result.stderr.length, 0);
});

test('native core recursively watches multiple roots and filters non-transcript files', async () => {
  const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gajae-core-watch-')));
  const firstRoot = path.join(temporaryRoot, 'first');
  const secondRoot = path.join(temporaryRoot, 'second');
  await Promise.all([
    mkdir(firstRoot, { recursive: true }),
    mkdir(secondRoot, { recursive: true }),
  ]);

  const child = spawn(corePath, [
    'watch',
    '--root',
    firstRoot,
    '--root',
    secondRoot,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const frames: Array<Record<string, unknown>> = [];
  let buffered = '';
  let diagnostics = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line) frames.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  child.stderr.on('data', (chunk: string) => {
    diagnostics += chunk;
  });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('native watcher process timed out.'));
      }, WATCHER_PROCESS_TIMEOUT_MS);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    },
  );
  const waitForFrame = async (
    predicate: (frame: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> => {
    for (let attempt = 0; attempt < WATCHER_FRAME_TIMEOUT_MS / WATCHER_FRAME_POLL_INTERVAL_MS; attempt += 1) {
      const frame = frames.find(predicate);
      if (frame) return frame;
      await new Promise((resolve) => setTimeout(resolve, WATCHER_FRAME_POLL_INTERVAL_MS));
    }
    throw new Error('Timed out waiting for native watcher frame.');
  };

  try {
    await waitForFrame((frame) => frame.kind === 'ready');
    const nested = path.join(firstRoot, 'workspace');
    await mkdir(nested);
    await writeFile(path.join(nested, 'ignored.txt'), 'ignored', 'utf8');
    const transcript = path.join(nested, 'session.jsonl');
    await writeFile(transcript, '{"type":"session"}\n', 'utf8');
    await waitForFrame((frame) => frame.kind === 'event' && frame.path === transcript);

    const priorTranscriptEvents = frames.filter((frame) => frame.path === transcript).length;
    await appendFile(transcript, '{"type":"message"}\n', 'utf8');
    await waitForFrame((_frame) => (
      frames.filter((frame) => frame.path === transcript).length > priorTranscriptEvents
    ));

    child.stdin.end();
    assert.deepEqual(await completed, { code: 0, signal: null });
    assert.equal(diagnostics, '');
    assert.equal(buffered, '');
    assert.equal(
      frames.some((frame) => typeof frame.path === 'string' && frame.path.endsWith('ignored.txt')),
      false,
    );
    assert.equal(
      frames.filter((frame) => frame.kind === 'event').every((frame) => (
        frame.event === 'add' || frame.event === 'change'
      )),
      true,
    );
  } finally {
    child.kill('SIGKILL');
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('native core relays bytes and child diagnostics without a shell', async () => {
  const script = [
    "process.stdin.on('data', (chunk) => process.stdout.write(chunk));",
    "process.stdin.on('end', () => { process.stderr.write('child diagnostic\\n'); process.exit(7); });",
  ].join('');
  const chunks = [
    Buffer.from('{"protocolVersion":1,"kind":"request"}\n'),
    Buffer.from('split-utf8-'),
    Buffer.from('한글\n'),
  ];
  const result = await runCore([
    '--',
    process.execPath,
    '--input-type=module',
    '--eval',
    script,
  ], chunks);

  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
  assert.deepEqual(result.stdout, Buffer.concat(chunks));
  assert.equal(result.stderr.toString('utf8'), 'child diagnostic\n');
});

test('native core preserves a successful child status after child stdin closes', async () => {
  const script = "process.stdin.destroy(); setTimeout(() => process.exit(0), 50);";
  const result = await runCore([
    '--',
    process.execPath,
    '--input-type=module',
    '--eval',
    script,
  ], [Buffer.alloc(1024 * 1024, 0x61)]);

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.length, 0);
});

test('native core fails safely when its child executable is unavailable', async () => {
  const result = await runCore([
    '--',
    '/definitely/missing/gajae-worker-executable',
  ]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.toString('utf8'), 'gajae-core: spawn failed\n');
});

test('native core carries the real worker initialize and shutdown protocol', async () => {
  const workerPath = fileURLToPath(new URL('./gjc-worker.ts', import.meta.url));
  const child = spawn(corePath, [
    '--',
    process.execPath,
    '--import',
    'tsx',
    workerPath,
  ], {
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses: Array<{ id?: string; payload?: { ok?: boolean } }> = [];
  let pending = '';
  let diagnostics = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { diagnostics += chunk; });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('native worker protocol test timed out.'));
      }, 5_000);
      child.stdout.on('data', (chunk: string) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line) continue;
          const response = JSON.parse(line) as { id?: string; payload?: { ok?: boolean } };
          responses.push(response);
          if (response.id === 'initialize' && response.payload?.ok === true) {
            child.stdin.write(`${JSON.stringify({
              protocolVersion: 1,
              kind: 'request',
              id: 'shutdown',
              method: 'worker.shutdown',
              payload: {},
            })}\n`);
          }
          if (response.id === 'shutdown' && response.payload?.ok === true) {
            child.stdin.end();
          }
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    },
  );

  child.stdin.write(`${JSON.stringify({
    protocolVersion: 1,
    kind: 'request',
    id: 'initialize',
    method: 'worker.initialize',
    payload: {},
  })}\n`);
  const exit = await completed;

  assert.deepEqual(exit, { code: 0, signal: null });
  assert.deepEqual(responses.map((response) => response.id), ['initialize', 'shutdown']);
  assert.equal(diagnostics, '');
});

test('native job authority persists and reconciles state across process replacement', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'gajae-core-jobs-'));
  const database = path.join(temporaryRoot, 'jobs.sqlite3');
  const lease = { owner: 'worker-a', generation: 1 };
  const frames = [
    {
      protocolVersion: 1,
      id: 'reserve',
      method: 'capacity.reserve',
      jobId: 'job-1',
      provider: 'gjc',
      owner: 'worker-a',
      cap: 4,
    },
    { protocolVersion: 1, id: 'queue', method: 'job.transition', jobId: 'job-1', lease, state: 'queued' },
    { protocolVersion: 1, id: 'start', method: 'job.transition', jobId: 'job-1', lease, state: 'running' },
    {
      protocolVersion: 1,
      id: 'event-1',
      method: 'event.append',
      jobId: 'job-1',
      lease,
      eventId: 'message-1',
      payload: { text: 'hello' },
    },
    {
      protocolVersion: 1,
      id: 'event-1-retry',
      method: 'event.append',
      jobId: 'job-1',
      lease,
      eventId: 'message-1',
      payload: { text: 'hello' },
    },
    {
      protocolVersion: 1,
      id: 'event-2',
      method: 'event.append',
      jobId: 'job-1',
      lease,
      eventId: 'message-2',
      payload: { text: 'world' },
    },
  ];
  try {
    const first = await runCore(
      ['jobs', '--database', database],
      [Buffer.from(frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n')],
    );
    assert.equal(first.code, 0);
    assert.equal(first.signal, null);
    assert.equal(first.stderr.length, 0);
    const firstResponses = first.stdout.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(firstResponses.map((response) => response.id), frames.map((frame) => frame.id));
    assert.deepEqual(firstResponses[0].result.lease, lease);
    assert.equal(firstResponses[1].result.state, 'queued');
    assert.equal(firstResponses[2].result.state, 'running');
    assert.deepEqual(firstResponses[3].result, firstResponses[4].result);

    const restartFrames = [
      { protocolVersion: 1, id: 'get', method: 'job.get', jobId: 'job-1' },
      {
        protocolVersion: 1,
        id: 'replay',
        method: 'event.replay',
        jobId: 'job-1',
        after: 0,
        byteBudget: 180,
      },
      { protocolVersion: 1, id: 'replay-page-2', method: 'event.replay', jobId: 'job-1', after: 1, byteBudget: 180 },
    ];
    const second = await runCore(
      ['jobs', '--database', database],
      [Buffer.from(restartFrames.map((frame) => JSON.stringify(frame)).join('\n') + '\n')],
    );
    assert.equal(second.code, 0);
    assert.equal(second.stderr.length, 0);
    const secondResponses = second.stdout.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(secondResponses[0].result.state, 'interrupted');
    assert.equal(secondResponses[0].result.lease, null);
    assert.deepEqual(secondResponses[1].result, {
      events: [{
        sequence: 1,
        eventId: 'message-1',
        payload: { text: 'hello' },
      }],
      nextCursor: 1,
    });
    assert.deepEqual(secondResponses[2].result, {
      events: [{
        sequence: 2,
        eventId: 'message-2',
        payload: { text: 'world' },
      }],
      nextCursor: null,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('native PTY relays bounded input, resize, output, and shutdown lifecycle', async () => {
  const child = spawn(corePath, [
    'pty',
    '--',
    process.execPath,
    '-e',
    'process.stdin.pipe(process.stdout)',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const frames: Array<Record<string, unknown>> = [];
  let buffered = '';
  let output = '';
  let diagnostics = '';
  let shutdownSent = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    diagnostics += chunk;
  });

  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('native PTY test timed out'));
    }, 5_000);
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      while (buffered.includes('\n')) {
        const newline = buffered.indexOf('\n');
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        const frame = JSON.parse(line) as Record<string, unknown>;
        frames.push(frame);
        if (frame.kind === 'ready') {
          child.stdin.write(`${JSON.stringify({
            protocolVersion: 1,
            method: 'pty.resize',
            cols: 100,
            rows: 30,
          })}\n`);
          child.stdin.write(`${JSON.stringify({
            protocolVersion: 1,
            method: 'pty.write',
            data: Buffer.from('native-pty-token\n').toString('base64'),
          })}\n`);
        }
        if (frame.kind === 'output' && typeof frame.data === 'string') {
          output += Buffer.from(frame.data, 'base64').toString('utf8');
          if (output.includes('native-pty-token') && !shutdownSent) {
            shutdownSent = true;
            child.stdin.write(`${JSON.stringify({
              protocolVersion: 1,
              method: 'pty.shutdown',
            })}\n`);
            child.stdin.end();
          }
        }
      }
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  const exit = await completed;
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(diagnostics, '');
  assert.equal(frames[0]?.kind, 'ready');
  assert.ok(frames.some((frame) => frame.kind === 'output'));
  assert.ok(frames.some((frame) => frame.kind === 'exit'));
  assert.match(output, /native-pty-token/u);
});
