import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { GjcSessionSynchronizer } from '@/modules/providers/list/gjc/gjc-session-synchronizer.provider.js';
import { asciiFileName, exportFileName, exportSessionTranscript } from '@/modules/providers/services/session-export.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => nextHomeDir;
  return () => {
    (os as unknown as { homedir: () => string }).homedir = original;
  };
};

const patchLiveSessionDir = (nextSessionDir: string) => {
  const original = process.env.GJC_LIVE_SESSION_DIR;
  process.env.GJC_LIVE_SESSION_DIR = nextSessionDir;
  return () => {
    if (original === undefined) {
      delete process.env.GJC_LIVE_SESSION_DIR;
    } else {
      process.env.GJC_LIVE_SESSION_DIR = original;
    }
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'gjc-export-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** One session on disk, in the shape the runtime writes. */
async function writeTranscript(homeDir: string, workspacePath: string, output: string): Promise<void> {
  const sessionsDir = path.join(homeDir, '.gjc', 'agent', 'sessions', '-workspace');
  await mkdir(sessionsDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'gjc-export',
      timestamp: '2026-08-27T00:00:00.000Z',
      cwd: workspacePath,
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg-1',
      parentId: null,
      timestamp: '2026-08-27T00:00:01.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Run the build' }] },
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg-2',
      parentId: 'msg-1',
      timestamp: '2026-08-27T00:00:02.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', toolName: 'bash', toolInput: { command: 'npm run build' }, toolCallId: 'call-1' },
        ],
      },
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg-3',
      parentId: 'msg-2',
      timestamp: '2026-08-27T00:00:03.000Z',
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'bash',
        content: [{ type: 'text', text: output }],
        isError: false,
      },
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg-4',
      parentId: 'msg-3',
      timestamp: '2026-08-27T00:00:04.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Build is green. See ```code``` below.' }] },
    }),
  ];
  await writeFile(
    path.join(sessionsDir, '2026-08-27T00-00-00_gjc-export.jsonl'),
    `${lines.join('\n')}\n`,
    'utf8',
  );
}

test('an exported session is the whole conversation, not the transport preview', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gjc-export-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);
  const restoreLiveSessionDir = patchLiveSessionDir(path.join(tempRoot, 'live-sessions'));

  try {
    // Over the 64KB transport budget, so the chat view sees a preview. An
    // export that shipped that preview would silently drop the middle of a
    // build log, which is exactly the part someone exports a log to read.
    const output = `시작-${'x'.repeat(90_000)}-끝`;
    await writeTranscript(tempRoot, workspacePath, output);

    await withIsolatedDatabase(async () => {
      await new GjcSessionSynchronizer().synchronize();

      const history = await sessionsService.fetchHistory('gjc-export');
      const previewed = history.messages.find((message) => message.kind === 'tool_use');
      assert.equal(previewed?.toolResultTruncated, true, 'the fixture must exceed the transport budget');

      const exported = await exportSessionTranscript('gjc-export', new Date('2026-08-27T05:00:00.000Z'));

      assert.match(exported.contentType, /^text\/markdown/);
      assert.match(exported.body, /^# /);
      assert.match(exported.body, /- Session: gjc-export/);
      assert.match(exported.body, /## User\n/);
      assert.match(exported.body, /Run the build/);
      assert.match(exported.body, /### Tool: bash/);
      assert.match(exported.body, /npm run build/);
      // The complete output, not the bounded preview the chat view receives.
      assert.ok(exported.body.includes(output));
      assert.equal(exported.body.includes('bytes omitted'), false);
    });
  } finally {
    restoreLiveSessionDir();
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('the route serves the file itself, with the name attached', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gjc-export-route-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);
  const restoreLiveSessionDir = patchLiveSessionDir(path.join(tempRoot, 'live-sessions'));

  try {
    await writeTranscript(tempRoot, workspacePath, 'build output');

    await withIsolatedDatabase(async () => {
      await new GjcSessionSynchronizer().synchronize();

      const [{ default: express }, { default: providerRoutes }] = await Promise.all([
        import('express'),
        import('@/modules/providers/provider.routes.js'),
      ]);
      const app = express().use('/api/providers', providerRoutes);
      const server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));

      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(`http://127.0.0.1:${port}/api/providers/sessions/gjc-export/export`);

        assert.equal(response.status, 200);
        // The body is the document, not the app's JSON envelope.
        assert.match(response.headers.get('content-type') ?? '', /^text\/markdown/);
        assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="[\x20-\x7E]+\.md"/);
        const body = await response.text();
        assert.match(body, /^# /);
        assert.match(body, /Run the build/);
        assert.equal(body.startsWith('{'), false);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  } finally {
    restoreLiveSessionDir();
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('content carrying its own fences cannot break out of the document', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gjc-export-fence-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);
  const restoreLiveSessionDir = patchLiveSessionDir(path.join(tempRoot, 'live-sessions'));

  try {
    // Tool output routinely holds Markdown of its own.
    await writeTranscript(tempRoot, workspacePath, '```js\nconst a = 1;\n```');

    await withIsolatedDatabase(async () => {
      await new GjcSessionSynchronizer().synchronize();
      const exported = await exportSessionTranscript('gjc-export', new Date('2026-08-27T05:00:00.000Z'));

      // The block that holds it must be fenced longer than anything inside it.
      assert.match(exported.body, /````\n```js\nconst a = 1;\n```\n````/);
    });
  } finally {
    restoreLiveSessionDir();
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('exporting a session that was never opened is a 404, not an empty file', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    await assert.rejects(
      () => exportSessionTranscript('does-not-exist'),
      /was not found/,
    );
  });
});

test('a session with no transcript yet still exports as a valid document', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    // An app-allocated session before its first run: no provider transcript
    // exists yet, so there is nothing on disk to read.
    sessionsDb.createAppSession('gjc-empty-export', 'gjc', path.join(os.tmpdir(), 'workspace-export'));

    const exported = await exportSessionTranscript('gjc-empty-export', new Date('2026-08-27T05:00:00.000Z'));

    assert.match(exported.body, /- Session: gjc-empty-export/);
    assert.match(exported.body, /no recorded messages/);
  });
});

test('the file name says which conversation it holds and stays portable', () => {
  const exportedAt = new Date('2026-08-27T05:00:00.000Z');

  assert.equal(exportFileName('Fix the pagination bug', 'gjc-1', exportedAt), 'fix-the-pagination-bug-2026-08-27.md');
  // Path separators, quotes and slashes never reach the file system.
  assert.equal(exportFileName('a/b: "c"', 'gjc-2', exportedAt), 'a-b-c-2026-08-27.md');
  // Non-latin titles keep their letters rather than collapsing to nothing.
  assert.equal(exportFileName('한글 제목', 'gjc-3', exportedAt), '한글-제목-2026-08-27.md');
  // A title with nothing usable falls back to the session id.
  assert.equal(exportFileName('///', 'gjc-4', exportedAt), 'gjc-4-2026-08-27.md');
});

test('a non-latin file name cannot poison the response header', async () => {
  const exportedAt = new Date('2026-08-27T05:00:00.000Z');

  // Node rejects any header value above latin1 with ERR_INVALID_CHAR, so the
  // plain `filename` parameter has to stay ASCII or the download 500s.
  assert.equal(asciiFileName('한글-제목-2026-08-27.md', 'gjc-9', exportedAt), 'gjc-9-2026-08-27.md');
  assert.equal(asciiFileName('fix-the-bug-2026-08-27.md', 'gjc-9', exportedAt), 'fix-the-bug-2026-08-27.md');

  // The real name still travels, percent-encoded, and the header is accepted.
  const { createServer } = await import('node:http');
  const header = `attachment; filename="${asciiFileName('한글-제목.md', 'gjc-9', exportedAt)}"; filename*=UTF-8''${encodeURIComponent('한글-제목.md')}`;
  const server = createServer((_request, response) => {
    response.setHeader('Content-Disposition', header);
    response.end('ok');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const request = new URL(`http://127.0.0.1:${port}/`);
      fetch(request)
        .then(async (response) => {
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('content-disposition'), header);
          await response.text();
          resolve();
        })
        .catch(reject)
        .finally(() => server.close());
    });
  });
});
