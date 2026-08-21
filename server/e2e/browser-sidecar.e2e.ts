import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

import {
  BROWSER_PROTOCOL_VERSION,
  type BrowserProtocolFrame,
  type BrowserRequestMethod,
} from '../modules/automation/browser-protocol.js';

class SidecarHarness {
  readonly child: ChildProcessWithoutNullStreams;
  readonly events: BrowserProtocolFrame[] = [];
  readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private sequence = 0;

  constructor(profileDirectory: string) {
    this.child = spawn(join(process.cwd(), 'dist-native', 'bun'), [
      join(process.cwd(), 'server', 'modules', 'automation', 'browser-sidecar.ts'),
    ], {
      env: { ...process.env, GAJAE_BROWSER_PROFILE_DIR: profileDirectory },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      const frame = JSON.parse(line) as BrowserProtocolFrame;
      if (frame.kind === 'response') {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        this.pending.delete(frame.id);
        if (frame.ok) pending.resolve(frame.result);
        else pending.reject(new Error(frame.error?.message ?? 'Browser sidecar request failed.'));
      } else {
        this.events.push(frame);
      }
    });
  }

  request(method: BrowserRequestMethod, sessionId?: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const id = `e2e-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({
        protocolVersion: BROWSER_PROTOCOL_VERSION,
        kind: 'request',
        id,
        method,
        ...(sessionId ? { sessionId } : {}),
        payload,
      })}\n`);
    });
  }

  async waitForEvent(method: string, timeoutMs = 5_000): Promise<BrowserProtocolFrame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = this.events.find((candidate) => candidate.kind === 'event' && candidate.method === method);
      if (event) return event;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${method}.`);
  }

  async waitForAsync(type: string, fromIndex = 0, timeoutMs = 5_000): Promise<BrowserProtocolFrame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = this.events.slice(fromIndex).find((candidate) => (
        candidate.kind === 'event'
        && candidate.method === 'async'
        && candidate.payload.type === type
      ));
      if (event) return event;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for async event ${type}.`);
  }

  async shutdown(): Promise<void> {
    if (this.child.exitCode !== null) return;
    await this.request('shutdown').catch(() => {});
    await new Promise<void>((resolve) => this.child.once('close', () => resolve()));
  }
}

test('real Chromium sidecar shares structured actions, tabs, and screencast state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gajae-browser-e2e-'));
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('content-disposition', 'attachment; filename="fixture.txt"');
      response.end('blocked download');
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/popup') {
      response.end('<!doctype html><title>Popup fixture</title><p>popup</p>');
      return;
    }
    response.end(`<!doctype html>
      <title>Gajae browser fixture</title>
      <main>
        <label>Name <input id="name" /></label>
        <button id="apply" onclick="document.querySelector('#result').textContent = document.querySelector('#name').value">Apply</button>
        <p id="result">waiting</p>
        <button id="dialog" onclick="alert('fixture dialog')">Open dialog</button>
        <a id="popup" href="/popup" target="_blank">Open popup</a>
        <a id="download" href="/download" download>Download fixture</a>
      </main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const sidecar = new SidecarHarness(join(root, 'profile'));
  t.after(async () => {
    await sidecar.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  await sidecar.waitForEvent('ready');
  await sidecar.request('initialize');
  const status = await sidecar.request('status') as { installed: boolean };
  assert.equal(status.installed, true, 'activate the Browser panel once before running this E2E');

  const opened = await sidecar.request('session.open', 'browser-e2e', { url, allowDownload: false }) as { tabs: unknown[] };
  assert.equal(opened.tabs.length, 1);
  await sidecar.request('screencast.subscribe', 'browser-e2e');
  await sidecar.waitForEvent('frame');

  const observed = await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'observe' },
  }) as { entries: Array<{ ref: number; name: string }> };
  assert.ok(observed.entries.some((entry) => entry.name === 'Apply'));

  await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'fill', selector: '#name', text: 'shared session' },
  });
  await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'click', selector: '#apply' },
  });
  const extracted = await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'extract', selector: '#result', format: 'text' },
  }) as { value: string };
  assert.equal(extracted.value, 'shared session');

  const dialogEventStart = sidecar.events.length;
  await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'click', selector: '#dialog' },
  });
  const dialogEvent = await sidecar.waitForAsync('dialog', dialogEventStart);
  assert.equal(dialogEvent.kind === 'event' && dialogEvent.payload.disposition, 'dismissed');
  assert.equal(dialogEvent.kind === 'event' && dialogEvent.payload.message, 'fixture dialog');

  const withSecondTab = await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'newTab' },
  }) as { tabs: unknown[] };
  assert.equal(withSecondTab.tabs.length, 2);
  const closeEventStart = sidecar.events.length;
  const afterClose = await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'closeTab' },
  }) as { tabs: unknown[] };
  assert.equal(afterClose.tabs.length, 1);
  await sidecar.waitForAsync('tab.closed', closeEventStart);

  const popupEventStart = sidecar.events.length;
  await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'click', selector: '#popup' },
  });
  const popupEvent = await sidecar.waitForAsync('popup', popupEventStart);
  assert.equal(popupEvent.kind === 'event' && popupEvent.payload.url, `${url}/popup`);
  const withPopup = await sidecar.request('session.state', 'browser-e2e') as { tabs: unknown[] };
  assert.equal(withPopup.tabs.length, 2);
  await sidecar.request('browser.command', 'browser-e2e', { command: { action: 'closeTab' } });

  const downloadEventStart = sidecar.events.length;
  await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'click', selector: '#download' },
  });
  const downloadEvent = await sidecar.waitForAsync('download.attempt', downloadEventStart);
  assert.equal(downloadEvent.kind === 'event' && downloadEvent.payload.suggestedFilename, 'fixture.txt');

  const navigationEventStart = sidecar.events.length;
  await sidecar.request('browser.command', 'browser-e2e', {
    command: { action: 'navigate', url: `${url}/next` },
  });
  const navigationEvent = await sidecar.waitForAsync('navigation', navigationEventStart);
  assert.equal(navigationEvent.kind === 'event' && navigationEvent.payload.url, `${url}/next`);

  const state = await sidecar.request('session.state', 'browser-e2e') as { activeTabId: string | null; tabs: unknown[] };
  assert.equal(state.tabs.length, 1);
  assert.ok(state.activeTabId);
  assert.deepEqual(await sidecar.request('session.close', 'browser-e2e'), { closed: true });
});
