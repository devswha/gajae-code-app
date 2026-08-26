import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getGjcLiveSessionRoot } from './shared/utils.js';

/**
 * These files are the conversation itself. They lived under `os.tmpdir()`,
 * which macOS reaps on its own schedule: 73 app-started sessions lost their
 * transcripts in one sweep while their database rows survived, so the sidebar
 * kept listing sessions that opened empty and stayed that way.
 *
 * The root therefore has to sit with the app's other durable state. A future
 * change that sends it back to a temp directory should fail here rather than
 * in a user's history weeks later.
 */

const withEnv = (value: string | undefined, run: () => void): void => {
  const previous = process.env.GJC_LIVE_SESSION_DIR;
  if (value === undefined) delete process.env.GJC_LIVE_SESSION_DIR;
  else process.env.GJC_LIVE_SESSION_DIR = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.GJC_LIVE_SESSION_DIR;
    else process.env.GJC_LIVE_SESSION_DIR = previous;
  }
};

test('live session transcripts default to durable app storage, never the temp directory', () => {
  withEnv(undefined, () => {
    const root = getGjcLiveSessionRoot();

    assert.equal(root, path.join(os.homedir(), '.gajae-app', 'gjc-live-sessions'));
    // The specific failure being guarded: any root the OS is free to delete.
    assert.ok(
      !root.startsWith(os.tmpdir()),
      `live session root must not sit under the temp directory, got ${root}`,
    );
    assert.doesNotMatch(root, /[/\\]T[/\\]|\/var\/folders\//u);
  });
});

test('an explicit override still wins so tests and isolated runs can redirect it', () => {
  withEnv('/tmp/gjc-live-sessions-override', () => {
    assert.equal(getGjcLiveSessionRoot(), '/tmp/gjc-live-sessions-override');
  });
});

test('every reader resolves the root through the shared helper', async () => {
  // The path was duplicated across the worker, the CLI, the synchronizer and
  // the watcher; a single stale copy would silently split writes from reads.
  const { readFile } = await import('node:fs/promises');
  const sources = [
    'server/gjc-cli.js',
    'server/gjc-worker-client.ts',
    'server/modules/providers/list/gjc/gjc-session-synchronizer.provider.ts',
    'server/modules/providers/services/sessions-watcher.service.ts',
  ];

  for (const source of sources) {
    const text = await readFile(path.join(process.cwd(), source), 'utf8');
    assert.doesNotMatch(
      text,
      /tmpdir\(\),\s*'gjc-live-sessions'/u,
      `${source} rebuilds the live session root instead of calling getGjcLiveSessionRoot()`,
    );
  }
});
