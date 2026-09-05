import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const executable = process.platform === 'win32' ? 'gajae-core.exe' : 'gajae-core';
const corePath = fileURLToPath(new URL(`../dist-native/${executable}`, import.meta.url));
const WATCHER_FRAME_TIMEOUT_MS = 60_000;
const WATCHER_PROCESS_TIMEOUT_MS = 90_000;
const WATCHER_FRAME_POLL_INTERVAL_MS = 10;

// Rust canonicalize emits verbatim drive/UNC paths on Windows; Node realpath
// returns their ordinary spelling. Compare the same filesystem path form.
const coreReportedPath = (value: string): string => path.toNamespacedPath(value);

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
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
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
    const transcriptFile = path.join(nested, 'session.jsonl');
    await writeFile(transcriptFile, '{"type":"session"}\n', 'utf8');
    const transcript = coreReportedPath(await realpath(transcriptFile));
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
    await closed;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('native core reports transcripts a directory already held when it appeared', async () => {
  const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gajae-core-watch-')));
  const root = path.join(temporaryRoot, 'root');
  const staged = path.join(temporaryRoot, 'staged');
  await mkdir(root, { recursive: true });
  await mkdir(path.join(staged, 'nested'), { recursive: true });
  await writeFile(path.join(staged, 'nested', 'session.jsonl'), '{"type":"session"}\n', 'utf8');
  await writeFile(path.join(staged, 'nested', 'ignored.txt'), 'ignored', 'utf8');

  const child = spawn(corePath, ['watch', '--root', root], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const frames: Array<Record<string, unknown>> = [];
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line) frames.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const waitForFrame = async (
    predicate: (frame: Record<string, unknown>) => boolean,
  ): Promise<void> => {
    for (let attempt = 0; attempt < WATCHER_FRAME_TIMEOUT_MS / WATCHER_FRAME_POLL_INTERVAL_MS; attempt += 1) {
      if (frames.some(predicate)) return;
      await new Promise((resolve) => setTimeout(resolve, WATCHER_FRAME_POLL_INTERVAL_MS));
    }
    throw new Error('Timed out waiting for native watcher frame.');
  };

  try {
    await waitForFrame((frame) => frame.kind === 'ready');
    // The whole populated tree arrives as one rename: the transcript inside it
    // is never observed by the watch, only the directory that now holds it.
    await rename(staged, path.join(root, 'moved'));
    const transcript = coreReportedPath(await realpath(path.join(root, 'moved', 'nested', 'session.jsonl')));
    await waitForFrame((frame) => (
      frame.kind === 'event' && frame.event === 'add' && frame.path === transcript
    ));

    assert.equal(
      frames.some((frame) => typeof frame.path === 'string' && frame.path.endsWith('ignored.txt')),
      false,
    );
  } finally {
    child.kill('SIGKILL');
    await closed;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('native core relays bytes and child diagnostics without a shell', async () => {
  const script = [
    "process.stdin.on('data', (chunk) => process.stdout.write(chunk));",
    // Windows pipe writes are asynchronous. Let both streams drain before
    // exiting, otherwise the fixture itself can truncate a correct relay.
    "process.stdin.on('end', () => { process.stderr.write('child diagnostic\\n'); process.exitCode = 7; });",
  ].join('');
  const unicode = Buffer.from('한글\n'.repeat(32 * 1024));
  const chunks = [
    Buffer.from('{"protocolVersion":1,"kind":"request"}\n'),
    Buffer.from('split-utf8-'),
    unicode.subarray(0, 1),
    unicode.subarray(1),
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
    path.join(os.tmpdir(), 'definitely-missing-gajae-worker', executable),
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

test('native git manages worktrees under paths with spaces and Unicode', async () => {
  const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gajae core git 한글 ')));
  const worktree = path.join(temporaryRoot, '.gjc-worktrees', 'job-1');
  const params = { jobId: 'job-1', branch: 'job/job-1', path: worktree };
  const git = (args: string[]) => execFileSync('git', ['-C', temporaryRoot, ...args], { encoding: 'utf8' });
  const request = async (method: string, requestParams: Record<string, unknown> = params) => {
    const result = await runCore(['git', '--workdir', temporaryRoot], [
      Buffer.from(`${JSON.stringify({ protocolVersion: 1, kind: 'request', id: method, method, params: requestParams })}\n`),
    ]);
    assert.equal(result.code, 0, result.stderr.toString('utf8'));
    assert.equal(result.stderr.length, 0);
    const frames = result.stdout.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(frames[0], { protocolVersion: 1, kind: 'ready' });
    assert.equal(frames.at(-1).id, method);
    assert.equal(frames.at(-1).ok, true, JSON.stringify(frames.at(-1)));
    return frames;
  };
  try {
    git(['init', '--quiet']);
    git(['config', 'core.autocrlf', 'false']);
    await writeFile(path.join(temporaryRoot, 'tracked.txt'), 'before\n');
    git(['add', 'tracked.txt']);
    git(['-c', 'user.name=Gajae Test', '-c', 'user.email=gajae@example.test', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'initial']);

    const created = (await request('worktree.create')).at(-1).result;
    assert.equal(created.created, true);
    assert.equal(created.worktree.path, coreReportedPath(await realpath(worktree)));
    assert.equal((await request('worktree.create')).at(-1).result.created, false);
    const listed = await request('worktree.list', {});
    assert.equal(listed.at(-1).result.count, 1);
    assert.equal(listed[1].item.path, created.worktree.path);

    await writeFile(path.join(worktree, 'new file.txt'), 'new file\n');
    assert.equal((await request('status')).at(-1).result.clean, false);
    const diff = await request('diff', { ...params, mode: 'unstaged', includeUntracked: true });
    const patch = Buffer.concat(diff.filter((frame) => frame.kind === 'chunk').map((frame) => Buffer.from(frame.data, 'base64'))).toString('utf8');
    assert.match(patch, /\+new file/u);
    await rm(path.join(worktree, 'new file.txt'));
    assert.equal((await request('worktree.prune', { ...params, confirmed: true })).at(-1).result.pruned, true);
    assert.equal((await request('worktree.list', {})).at(-1).result.count, 0);
    assert.ok(git(['show-ref', '--verify', 'refs/heads/job/job-1']).trim());
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('native PTY relays bounded input, resize, output, and shutdown lifecycle', async () => {
  const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gajae core pty 한글 ')));
  const cwdMarker = `native-cwd:${JSON.stringify(temporaryRoot)}`;
  const child = spawn(corePath, [
    'pty',
    '--',
    process.execPath,
    '-e',
    [
      "process.stdin.on('data', (chunk) => {",
      "console.log('native-cwd:' + JSON.stringify(process.cwd()));",
      "process.stdout.write('native-child-echo:' + chunk);",
      '});',
    ].join(''),
  ], {
    cwd: temporaryRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const frames: Array<Record<string, unknown>> = [];
  let buffered = '';
  let output = '';
  const decoder = new StringDecoder('utf8');
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
            cols: 1000,
            rows: 30,
          })}\n`);
          child.stdin.write(`${JSON.stringify({
            protocolVersion: 1,
            method: 'pty.write',
            data: Buffer.from('native-pty-token\r').toString('base64'),
          })}\n`);
        }
        if (frame.kind === 'output' && typeof frame.data === 'string') {
          output += decoder.write(Buffer.from(frame.data, 'base64'));
          if (output.includes('native-child-echo:native-pty-token') && output.includes(cwdMarker) && !shutdownSent) {
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
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  try {
    const exit = await completed;
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(diagnostics, '');
    assert.equal(frames[0]?.kind, 'ready');
    assert.ok(frames.some((frame) => frame.kind === 'output'));
    assert.ok(frames.some((frame) => frame.kind === 'exit'));
    assert.ok(output.includes(cwdMarker));
    assert.match(output, /native-child-echo:native-pty-token/u);
  } finally {
    child.kill('SIGKILL');
    await closed;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
