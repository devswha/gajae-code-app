/**
 * The app's Aside browser backend against the real pinned runtime.
 *
 * These sessions are built the way `gjc-bun-sdk-adapter.ts` builds them (the
 * app's tool allowlist, its settings policy, its browser backend bridge and
 * its automation transports) and then interrogated through the SDK's public
 * session surface. They answer the PoC's questions with the runtime rather than
 * with a fake: does the runtime see `browser.backend=aside`, does it inject its
 * own `<browser-backend>` routing, does it hide the browser tool, and does an
 * app-built session discover a user-scope `aside` skill from the agent dir.
 *
 * No Aside installation is required: the CLI probe is the injected seam, and
 * the `aside` skill is a test fixture written into a temporary agent dir, not
 * the real skill (which stays user-installed and runtime-owned).
 *
 * The ego backend is checked the same way: injected `ego-browser` probe, a
 * fixture `ego-browser` skill, and the runtime asked whether the app-owned
 * block reached the prompt while every built-in browser path is gone.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ModelRegistry } from '@gajae-code/coding-agent/config/model-registry';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { createAgentSession, discoverAuthStorage, type AutomationTools } from '@gajae-code/coding-agent/sdk/session';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import type { Skill } from '@gajae-code/coding-agent/extensibility/skills';

import { GJC_AGENT_TOOL_NAMES } from './gjc-agent-tools.js';
import { createGjcAutomationTools } from './gjc-automation-tools.js';
import {
  GJC_ASIDE_UNAVAILABLE_CODE,
  GJC_ASIDE_UNAVAILABLE_MESSAGE,
  GJC_EGO_BROWSER_INSTRUCTIONS,
  GJC_EGO_UNAVAILABLE_CODE,
  GJC_EGO_UNAVAILABLE_MESSAGE,
  type EgoBrowserCliProbe,
  type GjcBrowserBackend,
} from './gjc-browser-backend.js';
import { applyGjcBrowserBackend, applyGjcToolSettingsPolicy, selectGjcAutomationTools } from './gjc-bun-sdk-adapter.js';
import { GJC_APP_DELEGATION_TOOL_NAMES } from './gjc-delegation-executor.js';

const ASIDE_FOUND = () => ({ ok: true as const, path: '/fixture/.local/bin/aside' });
const ASIDE_MISSING = () => ({
  ok: false as const, searched: ['/fixture/.local/bin/aside', 'PATH (aside)'], manualInstallCommand: 'n/a', url: 'https://example.invalid',
});

const EGO_FOUND = (): EgoBrowserCliProbe => ({ ok: true, path: '/fixture/.local/bin/ego-browser' });
const EGO_MISSING = (): EgoBrowserCliProbe => ({ ok: false, searched: ['/fixture/.local/bin/ego-browser', 'PATH (ego-browser)'] });

const roots: string[] = [];
after(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

async function appRun(
  browserBackend: GjcBrowserBackend | undefined,
  probe: typeof ASIDE_FOUND | typeof ASIDE_MISSING = ASIDE_FOUND,
  inheritedRuntimeBackend?: 'native' | 'aside',
  egoProbe: () => EgoBrowserCliProbe = EGO_FOUND,
) {
  const root = await mkdtemp(join(tmpdir(), 'gjc-app-browser-backend-'));
  roots.push(root);
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await mkdir(cwd);
  // A user-scope skill named `aside`, exactly where `gjc` looks for one
  // (`<agentDir>/skills`). Fixture text only: the real skill is not copied.
  await mkdir(join(agentDir, 'skills', 'aside'), { recursive: true });
  await writeFile(join(agentDir, 'skills', 'aside', 'SKILL.md'), [
    '---', 'name: aside', 'description: Test fixture standing in for the user-installed Aside skill.', '---',
    'Fixture body. Not the Aside skill.', '',
  ].join('\n'));
  // Same for the user-installed `ego-browser` skill ego lite registers.
  await mkdir(join(agentDir, 'skills', 'ego-browser'), { recursive: true });
  await writeFile(join(agentDir, 'skills', 'ego-browser', 'SKILL.md'), [
    '---', 'name: ego-browser', 'description: Test fixture standing in for the user-installed ego-browser skill.', '---',
    'Fixture body. Not the ego-browser skill.', '',
  ].join('\n'));

  const authStorage = await discoverAuthStorage(agentDir);
  const settings = await Settings.loadForScope({ cwd, agentDir });
  settings.override('memory.enabled', false);
  settings.override('startup.networkPrewarm', false);
  applyGjcToolSettingsPolicy(settings);
  if (inheritedRuntimeBackend) settings.override('browser.backend', inheritedRuntimeBackend);
  const registry = new ModelRegistry(authStorage, join(agentDir, 'models.yml'), settings, { agentDir });
  registry.registerProvider('browser-backend-contract', {
    api: 'openai-completions', apiKey: 'offline-unusable-key', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'offline', name: 'Offline browser backend contract', reasoning: false,
      input: ['text'], contextWindow: 100000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  const disposeOwners = async () => { await registry.dispose(); authStorage.close(); await settings.close(); };
  return {
    cwd, agentDir, settings, disposeOwners,
    // The same two steps the adapter takes, in the same order: the bridge
    // first (it may refuse), then the automation transports it allows.
    applyBackend: () => applyGjcBrowserBackend(settings, browserBackend, probe, egoProbe),
    start: async () => {
      const backend = applyGjcBrowserBackend(settings, browserBackend, probe, egoProbe);
      const automationTools: AutomationTools = selectGjcAutomationTools(
        createGjcAutomationTools('app-session', { select: async () => undefined }, undefined, 'ask'),
        backend,
        true,
      );
      const { session } = await createAgentSession({
        // The adapter appends the app-owned block (ego only) after the runtime defaults.
        systemPrompt: (defaults: string[]) => [...defaults, ...(backend.appInstructions ? [backend.appInstructions] : [])],
        cwd, agentDir, settings, authStorage, modelRegistry: registry,
        model: registry.find('browser-backend-contract', 'offline'),
        sessionManager: SessionManager.create(cwd, join(root, 'sessions')),
        toolNames: [...GJC_AGENT_TOOL_NAMES, 'ask'].filter((name) => !GJC_APP_DELEGATION_TOOL_NAMES.includes(name as 'task' | 'subagent')),
        automationTools,
        spawns: 'deny', enableMcpAutoload: false, enableLsp: false,
        skipPythonPreflight: true, disableExtensionDiscovery: true,
        rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
      });
      return {
        session, backend, automationTools,
        prompt: session.systemPrompt.join('\n\n'),
        close: async () => { await session.dispose(); await disposeOwners(); },
      };
    },
  };
}

test('an app session with Built-in selected overrides an inherited Aside setting, keeps the app browser tool, and gets no Aside routing', { timeout: 60_000 }, async () => {
  const run = await appRun('builtin', ASIDE_FOUND, 'aside');
  const s = await run.start();
  try {
    assert.equal(s.backend.id, 'native');
    assert.equal(run.settings.get('browser.backend'), 'native');
    assert.ok(s.automationTools.browser, 'the app substitutes its WebView transport for the built-in browser tool');
    assert.ok(s.session.getActiveToolNames().includes('browser'));
    assert.equal(s.prompt.includes('<browser-backend>'), false);
    assert.equal(s.prompt.includes('aside repl'), false);
    assert.ok((s.session.skills as readonly Skill[]).some((skill) => skill.name === 'aside'), 'user-scope skills in <agentDir>/skills are discovered');
  } finally { await s.close(); }
});

test('an app session with Aside selected receives the runtime\u2019s own browser-aside routing, loses the browser tool, and can load the aside skill', { timeout: 60_000 }, async () => {
  const run = await appRun('aside');
  const s = await run.start();
  try {
    assert.equal(s.backend.id, 'aside');
    assert.equal(s.backend.exposesBuiltinTool, false);
    // What the runtime reads is its own setting, written through Settings.override.
    assert.equal(run.settings.get('browser.backend'), 'aside');
    assert.equal(s.automationTools.browser, undefined);
    assert.ok(s.automationTools.computer, 'the CUA transport is unaffected');
    assert.equal(s.session.getActiveToolNames().includes('browser'), false);
    assert.equal((s.session.getDiscoverableTools({ source: 'builtin' }) as Array<{ name: string }>).some((tool) => tool.name === 'browser'), false);
    // The routing block is the runtime's fragment, not app text: it names the
    // setting, both CLI modes, and the runtime's own skill instruction.
    assert.ok(s.prompt.includes('<browser-backend>'));
    assert.ok(s.prompt.includes('browser.backend: aside'));
    assert.ok(s.prompt.includes('aside repl'));
    assert.ok(s.prompt.includes('aside exec'));
    assert.ok(s.prompt.includes('Load the installed GJC `aside` skill'));
    assert.ok(s.session.getActiveToolNames().includes('bash'), 'Aside is reached through the runtime\u2019s Bash tool');
    assert.ok(s.session.getActiveToolNames().includes('skill'));
    const asideSkill = (s.session.skills as readonly Skill[]).find((skill) => skill.name === 'aside');
    assert.ok(asideSkill, 'the user-scope aside skill is discoverable by an app-built session');
    // Realpath may rewrite the tmpdir prefix; the location under the agent dir is what matters.
    assert.ok(asideSkill.filePath.endsWith(join('agent', 'skills', 'aside', 'SKILL.md')), asideSkill.filePath);
  } finally { await s.close(); }
});

test('Aside selected without an Aside CLI is refused before a session exists, and the runtime setting is left untouched', { timeout: 60_000 }, async () => {
  const run = await appRun('aside', ASIDE_MISSING);
  try {
    assert.throws(() => run.applyBackend(), (error: unknown) => error instanceof Error
      && (error as { code?: string }).code === GJC_ASIDE_UNAVAILABLE_CODE
      && error.message === GJC_ASIDE_UNAVAILABLE_MESSAGE
      && !error.message.includes('/fixture'));
    // Not Built-in by fallback: the override was never written, so the run
    // that would have used this settings object never starts at all.
    assert.equal(run.settings.getOverride('browser.backend'), undefined);
  } finally { await run.disposeOwners(); }
});

test('an app session with ego selected keeps the runtime on native, loses every built-in browser path, gets the app-owned ego block and can load the ego-browser skill', { timeout: 60_000 }, async () => {
  // An inherited user-level Aside setting must not leak its routing into an ego run.
  const run = await appRun('ego', ASIDE_MISSING, 'aside', EGO_FOUND);
  const s = await run.start();
  try {
    assert.equal(s.backend.id, 'ego');
    assert.equal(s.backend.exposesBuiltinTool, false);
    assert.equal(run.settings.get('browser.backend'), 'native');
    assert.equal(run.settings.get('browser.enabled'), false);
    assert.equal(s.automationTools.browser, undefined);
    assert.ok(s.automationTools.computer, 'the CUA transport is unaffected');
    assert.equal(s.session.getActiveToolNames().includes('browser'), false);
    assert.equal((s.session.getDiscoverableTools({ source: 'builtin' }) as Array<{ name: string }>).some((tool) => tool.name === 'browser'), false);
    // Exactly one <browser-backend> block, and it is the app's ego block, not the runtime's Aside fragment.
    assert.equal(s.prompt.split('<browser-backend>').length - 1, 1);
    assert.ok(s.prompt.includes(GJC_EGO_BROWSER_INSTRUCTIONS));
    assert.ok(s.prompt.includes("ego-browser nodejs <<'EOF'"));
    assert.equal(s.prompt.includes('aside repl'), false);
    assert.equal(s.prompt.includes('browser.backend: aside'), false);
    assert.ok(s.session.getActiveToolNames().includes('bash'), 'ego lite is reached through the runtime\u2019s Bash tool');
    assert.ok(s.session.getActiveToolNames().includes('skill'));
    const egoSkill = (s.session.skills as readonly Skill[]).find((skill) => skill.name === 'ego-browser');
    assert.ok(egoSkill, 'the user-scope ego-browser skill is discoverable by an app-built session');
    assert.ok(egoSkill.filePath.endsWith(join('agent', 'skills', 'ego-browser', 'SKILL.md')), egoSkill.filePath);
  } finally { await s.close(); }
});

test('ego selected without an ego-browser CLI is refused before a session exists, and no runtime setting is written', { timeout: 60_000 }, async () => {
  const run = await appRun('ego', ASIDE_FOUND, undefined, EGO_MISSING);
  try {
    assert.throws(() => run.applyBackend(), (error: unknown) => error instanceof Error
      && (error as { code?: string }).code === GJC_EGO_UNAVAILABLE_CODE
      && error.message === GJC_EGO_UNAVAILABLE_MESSAGE
      && !error.message.includes('/fixture'));
    assert.equal(run.settings.getOverride('browser.backend'), undefined);
    assert.equal(run.settings.getOverride('browser.enabled'), undefined);
  } finally { await run.disposeOwners(); }
});
