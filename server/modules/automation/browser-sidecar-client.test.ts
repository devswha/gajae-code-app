import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { BrowserEventFrame, BrowserSessionState } from './browser-protocol.js';
import { BrowserSidecarClient } from './browser-sidecar-client.js';

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

test('a crashed sidecar is restarted and restores the shared tabs and screencast subscription', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-browser-client-recovery-'));
  const sidecarPath = join(directory, 'fake-sidecar.mjs');
  const callsPath = join(directory, 'calls.ndjson');
  await writeFile(sidecarPath, `
    import { appendFileSync } from 'node:fs';
    import { spawn } from 'node:child_process';
    import readline from 'node:readline';
    const callsPath = ${JSON.stringify(callsPath)};
    const sessions = new Map();
    let sequence = 0;
    let browserProcess;
    const write = value => process.stdout.write(JSON.stringify(value) + '\\n');
    const state = id => sessions.get(id) ?? { sessionId: id, activeTabId: null, tabs: [] };
    const respond = (request, result) => write({ protocolVersion: 1, kind: 'response', id: request.id, method: request.method, ...(request.sessionId ? { sessionId: request.sessionId } : {}), ok: true, result });
    write({ protocolVersion: 1, kind: 'event', method: 'ready', payload: { protocolVersion: 1 } });
    readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
      const request = JSON.parse(line);
      appendFileSync(callsPath, JSON.stringify({ method: request.method, sessionId: request.sessionId }) + '\\n');
      if (request.method === 'initialize') return respond(request, { ready: true, protocolVersion: 1 });
      if (request.method === 'status') return respond(request, { state: 'ready', installed: true, buildId: 'fake' });
      if (request.method === 'session.open') {
        if (!browserProcess) {
          browserProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { detached: true, stdio: 'ignore' });
          browserProcess.unref();
          appendFileSync(callsPath, JSON.stringify({ browserPid: browserProcess.pid }) + '\\n');
          write({ protocolVersion: 1, kind: 'event', method: 'async', payload: { type: 'browser.process', pid: browserProcess.pid } });
        }
        const tab = { id: 'tab-' + (++sequence), title: 'Recovered', url: request.payload.url ?? 'about:blank', loading: false, canGoBack: false, canGoForward: false };
        const next = { sessionId: request.sessionId, activeTabId: tab.id, tabs: [tab] };
        sessions.set(request.sessionId, next);
        return respond(request, next);
      }
      if (request.method === 'session.state' || request.method === 'screencast.subscribe') return respond(request, state(request.sessionId));
      if (request.method === 'screencast.unsubscribe') return respond(request, { subscribed: false });
      if (request.method === 'session.close') {
        const closed = sessions.delete(request.sessionId);
        return respond(request, { closed });
      }
      if (request.method === 'browser.command' && request.payload.command?.action === 'run') return process.exit(23);
      if (request.method === 'shutdown') {
        if (browserProcess?.pid) {
          try { process.kill(-browserProcess.pid, 'SIGKILL'); } catch {}
        }
        respond(request, { shutdown: true });
        return setImmediate(() => process.exit(0));
      }
      respond(request, state(request.sessionId));
    });
  `);

  const client = new BrowserSidecarClient({
    runtimePath: process.execPath,
    sidecarPath,
    recoveryAttempts: 2,
    recoveryDelayMs: 10,
  });
  const events: BrowserEventFrame[] = [];
  client.subscribe((event) => events.push(event));
  try {
    const url = 'https://recovery.example.test/path';
    await client.open('recovery-session', { url, allowDownload: false });
    await client.subscribeFrames('recovery-session');

    await assert.rejects(
      client.command('recovery-session', { action: 'run', code: 'never settles' }),
      /disconnected/iu,
    );
    await waitFor(
      () => events.some((event) => event.method === 'async' && event.payload.type === 'sidecar.recovered'),
      'the browser sidecar did not publish a recovery event',
    );

    const restored = await client.state('recovery-session') as BrowserSessionState;
    assert.equal(restored.tabs.length, 1);
    assert.equal(restored.tabs[0]?.url, url);
    assert.ok(events.some((event) => event.method === 'error' && event.payload.recovering === true));
    assert.ok(events.some((event) => event.method === 'state' && event.payload.activeTabId === null));

    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { method?: string; browserPid?: number });
    assert.equal(calls.filter((call) => call.method === 'initialize').length, 2);
    assert.equal(calls.filter((call) => call.method === 'session.open').length, 2);
    assert.equal(calls.filter((call) => call.method === 'screencast.subscribe').length, 2);
    const browserPids = calls.flatMap((call) => call.browserPid ? [call.browserPid] : []);
    assert.equal(browserPids.length, 2);
    assert.throws(() => process.kill(browserPids[0]!, 0), /ESRCH/iu, 'the crashed sidecar\'s orphan browser must be reaped');
  } finally {
    await client.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
