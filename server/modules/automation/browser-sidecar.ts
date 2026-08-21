#!/usr/bin/env bun
/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

import {
  Browser as BrowserBinary,
  BrowserTag,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
} from '@puppeteer/browsers';
import puppeteer, {
  type Browser,
  type CDPSession,
  type KeyInput,
  type Page,
  type Target,
} from 'puppeteer-core';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';

import {
  BROWSER_PROTOCOL_VERSION,
  BrowserNdjsonDecoder,
  safeSessionId,
  serializeBrowserFrame,
  type BrowserCommand,
  type BrowserEventFrame,
  type BrowserInput,
  type BrowserRequestFrame,
  type BrowserResponseFrame,
  type BrowserSessionState,
  type BrowserTabState,
  type BrowserWaitUntil,
} from './browser-protocol.js';
import { normalizeAutomationUrl } from './automation-url.js';

type Tab = {
  id: string;
  page: Page;
  loading: boolean;
  refs: Map<number, number>;
  cdp?: CDPSession;
  screencasting: boolean;
};

type Session = {
  id: string;
  tabs: Map<string, Tab>;
  activeTabId: string | null;
  subscribed: boolean;
};

type AxNode = {
  ignored?: boolean;
  backendDOMNodeId?: number;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string | number | boolean };
};

const CACHE_ROOT = process.env.GAJAE_BROWSER_CACHE_DIR ?? join(homedir(), '.gajae-app', 'browser', 'chromium');
const PROFILE_ROOT = process.env.GAJAE_BROWSER_PROFILE_DIR ?? join(homedir(), '.gajae-app', 'browser', 'profile');
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const MAX_RUN_CODE_BYTES = 64 * 1024;
const MAX_RESULT_TEXT = 256 * 1024;

function writeFrame(frame: BrowserResponseFrame | BrowserEventFrame): void {
  process.stdout.write(serializeBrowserFrame(frame));
}

function emit(method: BrowserEventFrame['method'], payload: Record<string, unknown>, sessionId?: string): void {
  writeFrame({
    protocolVersion: BROWSER_PROTOCOL_VERSION,
    kind: 'event',
    method,
    ...(sessionId ? { sessionId } : {}),
    payload,
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const code = /^([a-z0-9_]+):/i.exec(raw)?.[1] ?? 'browser_error';
  const message = raw.replace(/^[a-z0-9_]+:\s*/i, '').slice(0, 1_000) || 'Browser operation failed.';
  return { code, message };
}

function waitUntil(value: unknown): BrowserWaitUntil {
  return value === 'load' || value === 'networkidle0' || value === 'networkidle2'
    ? value
    : 'domcontentloaded';
}

class BrowserRuntime {
  private browser?: Browser;
  private browserCdp?: CDPSession;
  private launchState: 'idle' | 'starting' | 'ready' | 'error' = 'idle';
  private launchError?: string;
  private launchPromise?: Promise<Browser>;
  private buildId: string = PUPPETEER_REVISIONS.chrome;
  private readonly sessions = new Map<string, Session>();
  private readonly ownerByTarget = new WeakMap<Target, string>();
  private readonly ownerByFrameId = new Map<string, { sessionId: string; tabId: string }>();

  async status(): Promise<Record<string, unknown>> {
    const installed = await this.installedBrowser();
    return {
      state: this.launchState,
      installed: Boolean(installed),
      buildId: this.buildId,
      ...(this.launchError ? { error: this.launchError } : {}),
    };
  }

  async open(sessionId: string, payload: Record<string, unknown>): Promise<BrowserSessionState> {
    const browser = await this.ensureBrowser(payload.allowDownload === true, sessionId);
    const session = this.session(sessionId);
    let tab = session.activeTabId ? session.tabs.get(session.activeTabId) : undefined;
    if (!tab || tab.page.isClosed()) {
      const page = await browser.newPage();
      tab = await this.registerPage(session, page);
    }
    const url = typeof payload.url === 'string' ? normalizeAutomationUrl(payload.url) : undefined;
    if (url && tab.page.url() !== url) {
      tab.loading = true;
      this.emitState(session);
      await tab.page.goto(url, { waitUntil: waitUntil(payload.waitUntil), timeout: 30_000 });
    }
    session.activeTabId = tab.id;
    if (session.subscribed) await this.ensureScreencast(session);
    return this.state(session);
  }

  async close(sessionId: string): Promise<{ closed: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { closed: false };
    this.sessions.delete(sessionId);
    await Promise.all([...session.tabs.values()].map(async (tab) => {
      await this.stopScreencast(tab);
      if (!tab.page.isClosed()) await tab.page.close().catch(() => {});
    }));
    return { closed: true };
  }

  stateFor(sessionId: string): BrowserSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session_not_found: Open the browser session first.');
    return this.state(session);
  }

  async subscribe(sessionId: string): Promise<BrowserSessionState> {
    const session = this.session(sessionId);
    session.subscribed = true;
    await this.ensureScreencast(session);
    return this.state(session);
  }

  async unsubscribe(sessionId: string): Promise<{ subscribed: false }> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.subscribed = false;
      await Promise.all([...session.tabs.values()].map((tab) => this.stopScreencast(tab)));
    }
    return { subscribed: false };
  }

  async command(sessionId: string, command: BrowserCommand): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session_not_found: Open the browser session first.');
    if (command.action === 'selectTab') {
      if (!session.tabs.has(command.tabId)) throw new Error('tab_not_found: Browser tab was not found.');
      session.activeTabId = command.tabId;
      await this.ensureScreencast(session);
      this.emitState(session);
      return this.state(session);
    }
    if (command.action === 'newTab') {
      const browser = await this.ensureBrowser(false, sessionId);
      const page = await browser.newPage();
      const created = await this.registerPage(session, page);
      if (command.url) {
        await page.goto(normalizeAutomationUrl(command.url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      }
      session.activeTabId = created.id;
      await this.ensureScreencast(session);
      this.emitState(session);
      return this.state(session);
    }
    if (command.action === 'closeTab') {
      const closing = command.tabId ? session.tabs.get(command.tabId) : this.activeTab(session);
      if (!closing) throw new Error('tab_not_found: Browser tab was not found.');
      await this.stopScreencast(closing);
      if (!closing.page.isClosed()) await closing.page.close();
      await this.ensureScreencast(session);
      this.emitState(session);
      return this.state(session);
    }
    const tab = this.activeTab(session);
    const page = tab.page;

    switch (command.action) {
      case 'navigate':
        tab.loading = true;
        this.emitState(session);
        await page.goto(normalizeAutomationUrl(command.url), { waitUntil: waitUntil(command.waitUntil), timeout: 30_000 });
        break;
      case 'back':
        tab.loading = true;
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        break;
      case 'forward':
        tab.loading = true;
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        break;
      case 'reload':
        tab.loading = true;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        break;
      case 'click':
        await this.click(tab, command);
        break;
      case 'type':
        await this.focus(tab, command);
        await page.keyboard.type(command.text);
        break;
      case 'fill':
        await this.focus(tab, command);
        await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
        await page.keyboard.press('A');
        await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
        await page.keyboard.type(command.text);
        break;
      case 'select':
        if (command.selector) await page.select(command.selector, ...command.values);
        else await this.callOnRef(tab, command.ref, `function(...values) {
          const options = Array.from(this.options || []);
          for (const option of options) option.selected = values.includes(option.value);
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return Array.from(this.selectedOptions || []).map(option => option.value);
        }`, command.values);
        break;
      case 'press':
        await page.keyboard.press(command.key as KeyInput);
        break;
      case 'scroll':
        await page.mouse.wheel({ deltaX: command.dx ?? 0, deltaY: command.dy ?? 600 });
        break;
      case 'wait':
        if (command.selector) await page.waitForSelector(command.selector, { timeout: command.ms ?? 10_000 });
        else if (command.text) await page.waitForFunction((text) => document.body?.innerText.includes(text), { timeout: command.ms ?? 10_000 }, command.text);
        else await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(command.ms ?? 500, 0), 30_000)));
        break;
      case 'observe':
        return this.observe(tab, command.includeAll === true);
      case 'extract': {
        const format = command.format ?? 'text';
        const result = await page.evaluate(({ selector, format }) => {
          const element = selector ? document.querySelector(selector) : document.body;
          if (!element) return null;
          return format === 'html' ? element.outerHTML : (element.textContent ?? '');
        }, { selector: command.selector, format });
        return { value: typeof result === 'string' ? result.slice(0, MAX_RESULT_TEXT) : result };
      }
      case 'screenshot': {
        const data = await page.screenshot({ type: 'jpeg', quality: 75, encoding: 'base64' });
        return { mimeType: 'image/jpeg', data };
      }
      case 'run': {
        if (Buffer.byteLength(command.code) > MAX_RUN_CODE_BYTES) throw new Error('run_too_large: Browser script is too large.');
        const timeoutMs = Math.min(Math.max(command.timeoutMs ?? 30_000, 1), 300_000);
        const value = await Promise.race([
          page.evaluate((source) => (0, eval)(source), command.code),
          new Promise((_, reject) => setTimeout(() => reject(new Error('run_timeout: Browser script timed out.')), timeoutMs)),
        ]);
        const serialized = JSON.stringify(value);
        return { value: serialized && serialized.length > MAX_RESULT_TEXT ? `${serialized.slice(0, MAX_RESULT_TEXT)}…` : value };
      }
    }

    this.emitState(session);
    return this.state(session);
  }

  async input(sessionId: string, input: BrowserInput): Promise<{ accepted: true }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session_not_found: Open the browser session first.');
    const tab = this.activeTab(session);
    const cdp = await this.cdp(tab);
    if (input.kind === 'mouse') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: input.event === 'move' ? 'mouseMoved' : input.event === 'down' ? 'mousePressed' : 'mouseReleased',
        x: input.x,
        y: input.y,
        button: input.button ?? 'left',
        clickCount: input.clickCount ?? 1,
      });
    } else if (input.kind === 'wheel') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY,
      });
    } else if (input.kind === 'text') {
      await cdp.send('Input.insertText', { text: input.text });
    } else {
      await cdp.send('Input.dispatchKeyEvent', {
        type: input.event === 'down' ? 'keyDown' : 'keyUp',
        key: input.key,
        code: input.code ?? input.key,
        modifiers: input.modifiers ?? 0,
      });
    }
    return { accepted: true };
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.close(id);
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
    this.browserCdp = undefined;
    this.ownerByFrameId.clear();
    this.launchState = 'idle';
  }

  private session(id: string): Session {
    let session = this.sessions.get(id);
    if (!session) {
      session = { id, tabs: new Map(), activeTabId: null, subscribed: false };
      this.sessions.set(id, session);
    }
    return session;
  }

  private activeTab(session: Session): Tab {
    const tab = session.activeTabId ? session.tabs.get(session.activeTabId) : undefined;
    if (!tab || tab.page.isClosed()) throw new Error('tab_not_found: Browser tab was not found.');
    return tab;
  }

  private async installedBrowser() {
    const override = process.env.GAJAE_BROWSER_EXECUTABLE_PATH;
    if (override && existsSync(override)) {
      return { browser: BrowserBinary.CHROME, buildId: 'system-override', executablePath: override };
    }
    const installed = await getInstalledBrowsers({ cacheDir: CACHE_ROOT });
    return installed.find((item) => item.browser === BrowserBinary.CHROME && item.buildId === this.buildId)
      ?? installed.filter((item) => item.browser === BrowserBinary.CHROME).at(-1);
  }

  private async ensureBrowser(allowDownload: boolean, sessionId?: string): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launchPromise) return this.launchPromise;
    this.launchState = 'starting';
    this.launchError = undefined;
    this.launchPromise = (async () => {
      const platform = detectBrowserPlatform();
      if (!platform) throw new Error('unsupported_platform: Chromium is unavailable on this platform.');
      let installed = await this.installedBrowser();
      if (!installed) {
        if (!allowDownload) throw new Error('browser_download_required: Chromium must be downloaded before first use.');
        this.buildId = await resolveBuildId(BrowserBinary.CHROME, platform, BrowserTag.STABLE).catch(() => PUPPETEER_REVISIONS.chrome);
        emit('download.progress', { phase: 'starting', buildId: this.buildId }, sessionId);
        installed = await install({
          browser: BrowserBinary.CHROME,
          buildId: this.buildId,
          cacheDir: CACHE_ROOT,
          platform,
          downloadProgressCallback(downloadedBytes, totalBytes) {
            emit('download.progress', { phase: 'downloading', downloadedBytes, totalBytes, buildId: String(PUPPETEER_REVISIONS.chrome) }, sessionId);
          },
        });
        emit('download.progress', { phase: 'complete', buildId: this.buildId }, sessionId);
      }
      await mkdir(PROFILE_ROOT, { recursive: true });
      if (!existsSync(installed.executablePath)) throw new Error('browser_missing: Chromium executable was not found.');
      const browser = await puppeteer.launch({
        executablePath: installed.executablePath,
        userDataDir: PROFILE_ROOT,
        headless: true,
        defaultViewport: DEFAULT_VIEWPORT,
        downloadBehavior: { policy: 'deny' },
        args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
      });
      const browserCdp = await browser.target().createCDPSession();
      await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
      browserCdp.on('Browser.downloadWillBegin', (event) => {
        const owner = this.ownerByFrameId.get(event.frameId);
        if (!owner) return;
        emit('async', {
          type: 'download.attempt',
          tabId: owner.tabId,
          url: event.url,
          suggestedFilename: event.suggestedFilename,
        }, owner.sessionId);
      });
      this.browserCdp = browserCdp;
      browser.on('targetcreated', (target) => void this.onTargetCreated(target));
      browser.on('disconnected', () => {
        this.browser = undefined;
        this.launchState = 'idle';
        for (const session of this.sessions.values()) this.emitState(session);
      });
      this.browser = browser;
      this.launchState = 'ready';
      return browser;
    })().catch((error) => {
      this.launchState = 'error';
      this.launchError = sanitizeError(error).message;
      throw error;
    }).finally(() => {
      this.launchPromise = undefined;
    });
    return this.launchPromise;
  }

  private async onTargetCreated(target: Target): Promise<void> {
    const opener = target.opener();
    const sessionId = opener ? this.ownerByTarget.get(opener) : undefined;
    if (!sessionId || target.type() !== 'page') return;
    const page = await target.page();
    const session = this.sessions.get(sessionId);
    if (!page || !session) return;
    const tab = await this.registerPage(session, page);
    session.activeTabId = tab.id;
    emit('async', { type: 'popup', tabId: tab.id, url: page.url() }, sessionId);
    if (session.subscribed) await this.ensureScreencast(session);
  }

  private async registerPage(session: Session, page: Page): Promise<Tab> {
    const existing = [...session.tabs.values()].find((tab) => tab.page === page);
    if (existing) return existing;
    const tab: Tab = { id: `tab-${randomUUID()}`, page, loading: false, refs: new Map(), screencasting: false };
    session.tabs.set(tab.id, tab);
    session.activeTabId = tab.id;
    this.ownerByTarget.set(page.target(), session.id);
    await page.setViewport(DEFAULT_VIEWPORT);
    const cdp = await this.cdp(tab);
    const rememberMainFrame = (frameId: string) => {
      this.ownerByFrameId.set(frameId, { sessionId: session.id, tabId: tab.id });
    };
    const frameTree = await cdp.send('Page.getFrameTree');
    rememberMainFrame(frameTree.frameTree.frame.id);
    cdp.on('Page.frameNavigated', (event) => {
      if (!event.frame.parentId) rememberMainFrame(event.frame.id);
    });
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        tab.loading = true;
        this.emitState(session);
      }
    });
    const settle = () => { tab.loading = false; this.emitState(session); };
    page.on('domcontentloaded', settle);
    page.on('load', settle);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        tab.refs.clear();
        emit('async', { type: 'navigation', tabId: tab.id, url: frame.url() }, session.id);
        this.emitState(session);
      }
    });
    page.on('dialog', (dialog) => {
      emit('async', {
        type: 'dialog',
        dialogType: dialog.type(),
        message: dialog.message(),
        disposition: 'dismissed',
      }, session.id);
      void dialog.dismiss().catch(() => {});
    });
    page.on('close', () => {
      for (const [frameId, owner] of this.ownerByFrameId) {
        if (owner.sessionId === session.id && owner.tabId === tab.id) this.ownerByFrameId.delete(frameId);
      }
      session.tabs.delete(tab.id);
      if (session.activeTabId === tab.id) session.activeTabId = session.tabs.keys().next().value ?? null;
      emit('async', { type: 'tab.closed', tabId: tab.id }, session.id);
      this.emitState(session);
    });
    this.emitState(session);
    return tab;
  }

  private async history(tab: Tab): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
    try {
      const cdp = await this.cdp(tab);
      const history = await cdp.send('Page.getNavigationHistory') as { currentIndex: number; entries: unknown[] };
      return { canGoBack: history.currentIndex > 0, canGoForward: history.currentIndex < history.entries.length - 1 };
    } catch {
      return { canGoBack: false, canGoForward: false };
    }
  }

  private state(session: Session): BrowserSessionState {
    return {
      sessionId: session.id,
      activeTabId: session.activeTabId,
      tabs: [...session.tabs.values()].map((tab): BrowserTabState => ({
        id: tab.id,
        title: '',
        url: tab.page.url(),
        loading: tab.loading,
        canGoBack: false,
        canGoForward: false,
      })),
    };
  }

  private emitState(session: Session): void {
    void Promise.all([...session.tabs.values()].map(async (tab): Promise<BrowserTabState> => {
      const [title, history] = await Promise.all([tab.page.title().catch(() => ''), this.history(tab)]);
      return { id: tab.id, title, url: tab.page.url(), loading: tab.loading, ...history };
    })).then((tabs) => emit('state', { sessionId: session.id, activeTabId: session.activeTabId, tabs }, session.id)).catch(() => {});
  }

  private async cdp(tab: Tab): Promise<CDPSession> {
    if (!tab.cdp) tab.cdp = await tab.page.createCDPSession();
    return tab.cdp;
  }

  private async ensureScreencast(session: Session): Promise<void> {
    const active = session.activeTabId;
    await Promise.all([...session.tabs.values()].map(async (tab) => {
      if (tab.id === active && session.subscribed) await this.startScreencast(session, tab);
      else await this.stopScreencast(tab);
    }));
  }

  private async startScreencast(session: Session, tab: Tab): Promise<void> {
    if (tab.screencasting || tab.page.isClosed()) return;
    const cdp = await this.cdp(tab);
    tab.screencasting = true;
    cdp.on('Page.screencastFrame', (event) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (!tab.screencasting || session.activeTabId !== tab.id || !session.subscribed) return;
      emit('frame', {
        tabId: tab.id,
        mimeType: 'image/jpeg',
        data: event.data,
        metadata: event.metadata as unknown as Record<string, unknown>,
      }, session.id);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 70, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1,
    });
  }

  private async stopScreencast(tab: Tab): Promise<void> {
    if (!tab.screencasting) return;
    tab.screencasting = false;
    await tab.cdp?.send('Page.stopScreencast').catch(() => {});
  }

  private async observe(tab: Tab, includeAll: boolean): Promise<Record<string, unknown>> {
    const cdp = await this.cdp(tab);
    const response = await cdp.send('Accessibility.getFullAXTree') as { nodes?: AxNode[] };
    tab.refs.clear();
    const entries: Array<{ ref: number; role: string; name: string; value?: string }> = [];
    for (const node of response.nodes ?? []) {
      if (node.ignored || typeof node.backendDOMNodeId !== 'number') continue;
      const role = String(node.role?.value ?? '');
      const name = String(node.name?.value ?? '').trim();
      if (!includeAll && !name && !/button|link|textbox|checkbox|radio|combobox|menuitem|tab/i.test(role)) continue;
      const ref = entries.length + 1;
      tab.refs.set(ref, node.backendDOMNodeId);
      entries.push({
        ref,
        role,
        name,
        ...(node.value?.value !== undefined ? { value: String(node.value.value) } : {}),
      });
      if (entries.length >= (includeAll ? 500 : 200)) break;
    }
    return { url: tab.page.url(), title: await tab.page.title(), entries };
  }

  private backendNode(tab: Tab, ref: number | undefined): number {
    if (typeof ref !== 'number') throw new Error('target_required: Provide a ref, selector, or coordinates.');
    const backendNodeId = tab.refs.get(ref);
    if (!backendNodeId) throw new Error('stale_ref: Observe the page again before using this ref.');
    return backendNodeId;
  }

  private async click(tab: Tab, command: Extract<BrowserCommand, { action: 'click' }>): Promise<void> {
    if (command.selector) {
      await tab.page.click(command.selector);
      return;
    }
    if (typeof command.x === 'number' && typeof command.y === 'number') {
      await tab.page.mouse.click(command.x, command.y);
      return;
    }
    const cdp = await this.cdp(tab);
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId: this.backendNode(tab, command.ref) }) as { model?: { content?: number[]; border?: number[] } };
    const quad = box.model?.content ?? box.model?.border;
    if (!quad || quad.length < 8) throw new Error('element_not_visible: The referenced element has no clickable box.');
    const xs = [quad[0], quad[2], quad[4], quad[6]] as number[];
    const ys = [quad[1], quad[3], quad[5], quad[7]] as number[];
    await tab.page.mouse.click(xs.reduce((a, b) => a + b, 0) / 4, ys.reduce((a, b) => a + b, 0) / 4);
  }

  private async focus(tab: Tab, target: { ref?: number; selector?: string }): Promise<void> {
    if (target.selector) {
      await tab.page.focus(target.selector);
      return;
    }
    await this.callOnRef(tab, target.ref, 'function() { this.focus(); return true; }', []);
  }

  private async callOnRef(tab: Tab, ref: number | undefined, functionDeclaration: string, args: unknown[]): Promise<unknown> {
    const cdp = await this.cdp(tab);
    const resolved = await cdp.send('DOM.resolveNode', { backendNodeId: this.backendNode(tab, ref) }) as { object?: { objectId?: string } };
    const objectId = resolved.object?.objectId;
    if (!objectId) throw new Error('element_unavailable: The referenced element is unavailable.');
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error('element_action_failed: The element action failed.');
    return result.result?.value;
  }
}

const runtime = new BrowserRuntime();
const decoder = new BrowserNdjsonDecoder();
let requestQueue = Promise.resolve();

async function handle(frame: BrowserRequestFrame): Promise<void> {
  let result: unknown;
  try {
    if (frame.method !== 'initialize' && frame.method !== 'status' && frame.method !== 'shutdown' && !safeSessionId(frame.sessionId)) {
      throw new Error('invalid_session: A valid browser session id is required.');
    }
    switch (frame.method) {
      case 'initialize':
        result = { ready: true, protocolVersion: BROWSER_PROTOCOL_VERSION };
        break;
      case 'status':
        result = await runtime.status();
        break;
      case 'session.open':
        result = await runtime.open(frame.sessionId!, frame.payload);
        break;
      case 'session.state':
        result = runtime.stateFor(frame.sessionId!);
        break;
      case 'session.close':
        result = await runtime.close(frame.sessionId!);
        break;
      case 'browser.command':
        result = await runtime.command(frame.sessionId!, object(frame.payload.command) as BrowserCommand);
        break;
      case 'browser.input':
        result = await runtime.input(frame.sessionId!, object(frame.payload.input) as BrowserInput);
        break;
      case 'screencast.subscribe':
        result = await runtime.subscribe(frame.sessionId!);
        break;
      case 'screencast.unsubscribe':
        result = await runtime.unsubscribe(frame.sessionId!);
        break;
      case 'shutdown':
        await runtime.shutdown();
        result = { shutdown: true };
        break;
    }
    writeFrame({
      protocolVersion: BROWSER_PROTOCOL_VERSION,
      kind: 'response',
      id: frame.id,
      method: frame.method,
      ...('sessionId' in frame ? { sessionId: frame.sessionId } : {}),
      ok: true,
      result,
    });
    if (frame.method === 'shutdown') process.exit(0);
  } catch (error) {
    writeFrame({
      protocolVersion: BROWSER_PROTOCOL_VERSION,
      kind: 'response',
      id: frame.id,
      method: frame.method,
      ...('sessionId' in frame ? { sessionId: frame.sessionId } : {}),
      ok: false,
      error: sanitizeError(error),
    });
  }
}

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  try {
    for (const frame of decoder.push(`${line}\n`)) {
      if (frame.kind !== 'request') throw new Error('Only request frames are accepted.');
      requestQueue = requestQueue.then(() => handle(frame)).catch((error) => {
        process.stderr.write(`${sanitizeError(error).message}\n`);
      });
    }
  } catch (error) {
    process.stderr.write(`${sanitizeError(error).message}\n`);
  }
});

emit('ready', { protocolVersion: BROWSER_PROTOCOL_VERSION });
