import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { ModelRegistry } from '@gajae-code/coding-agent/config/model-registry';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { createAgentSession, discoverAuthStorage } from '@gajae-code/coding-agent/sdk/session';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';

import { applyGjcToolSettingsPolicy } from './gjc-bun-sdk-adapter.js';

/*
 * MCP servers reach an app session exactly as they reach a GJC CLI session
 * (owner decision 2026-09-27, which replaces the project-scope refusal of
 * #161):
 *
 * - user scope, `<agentDir>/mcp.json` (what `gjc mcp add` writes);
 * - project scope, `<cwd>/.gjc/mcp.json` (what `gjc mcp add --project` writes),
 *   which the runtime loads unless `mcp.enableProjectConfig` is set to false.
 *
 * Both depend on runtime behaviour the app does not own - conventional
 * autoload, the "unset means true" reading of `mcp.enableProjectConfig`, and
 * the always-include of conventional tools past an explicit `toolNames` - so
 * both are pinned against the real SDK with a real stdio server. A bun test
 * because the package cannot be imported from node at all.
 */

const STDIO_MCP_SERVER = `
import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: {
    protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0.0.0' } } });
  if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools: [{
    name: 'probe_echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
  if (message.method === 'tools/call') return send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ok' }] } });
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported' } });
});
`;

async function fixture() {
  const scratch = join(await realpath(process.cwd()), '.tmp');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'gjc-mcp-autoload-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await mkdir(join(cwd, '.gjc'), { recursive: true });
  await mkdir(agentDir);
  const server = join(root, 'probe-mcp-server.mjs');
  await writeFile(server, STDIO_MCP_SERVER);
  const registration = (name: string) => JSON.stringify({
    mcpServers: { [name]: { type: 'stdio', command: process.execPath, args: [server] } },
  });
  await writeFile(join(agentDir, 'mcp.json'), registration('userscope'));
  await writeFile(join(cwd, '.gjc', 'mcp.json'), registration('projectscope'));

  const authStorage = await discoverAuthStorage(agentDir);
  const settings = await Settings.loadForScope({ cwd, agentDir });
  settings.override('memory.enabled', false);
  settings.override('skills.enabled', false);
  const registry = new ModelRegistry(authStorage, join(agentDir, 'models.yml'), settings, { agentDir });
  // No transport is ever reached: the session is inspected, never prompted.
  registry.registerProvider('mcp-scope-contract', {
    api: 'openai-completions', apiKey: 'offline-mcp-scope-key', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'probe', name: 'Offline MCP scope fixture', reasoning: false, input: ['text'],
      contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  return {
    cwd, agentDir, settings,
    async open(extra: Partial<Parameters<typeof createAgentSession>[0]> = {}) {
      const { session } = await createAgentSession({
        cwd, agentDir, settings, authStorage, modelRegistry: registry, model: registry.find('mcp-scope-contract', 'probe'),
        sessionManager: SessionManager.create(cwd, join(root, 'sessions')),
        // The app always sends an explicit selection; MCP tools are never in it.
        toolNames: ['read', 'bash'], spawns: 'deny',
        enableLsp: false, skipPythonPreflight: true, disableExtensionDiscovery: true,
        skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
        ...extra,
      });
      return session;
    },
    async close() {
      await registry.dispose(); authStorage.close(); await settings.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const userTool = 'mcp__userscope_probe_echo';
const projectTool = 'mcp__projectscope_probe_echo';

test('with the app policy, both scopes load as in the CLI', async () => {
  const f = await fixture();
  try {
    applyGjcToolSettingsPolicy(f.settings);
    const session = await f.open();
    try {
      const active = session.getActiveToolNames();
      assert.ok(active.includes(userTool), `user-scope MCP tool missing from: ${active.join(', ')}`);
      assert.ok(active.includes(projectTool), `project-scope MCP tool missing from: ${active.join(', ')}`);
      // Always-on, not merely discoverable: the tools were not in `toolNames`,
      // yet they are active for the model right now.
      assert.ok(session.getToolByName(userTool), 'the user-scope tool must be executable, not just listed');
      assert.ok(session.getToolByName(projectTool), 'the project-scope tool must be executable, not just listed');
    } finally { await session.dispose(); }
  } finally { await f.close(); }
});

test('a user who turned project scope off in ~/.gjc keeps that choice in the app', async () => {
  const f = await fixture();
  try {
    f.settings.override('mcp.enableProjectConfig', false);
    applyGjcToolSettingsPolicy(f.settings);
    const session = await f.open();
    try {
      const active = session.getActiveToolNames();
      assert.ok(active.includes(userTool), active.join(', '));
      assert.ok(!active.includes(projectTool), active.join(', '));
    } finally { await session.dispose(); }
  } finally { await f.close(); }
});

test('opting out of the autoload is what removes user-scope servers, and the app does not do that', async () => {
  const f = await fixture();
  try {
    applyGjcToolSettingsPolicy(f.settings);
    const session = await f.open({ enableMcpAutoload: false });
    try {
      const active = session.getActiveToolNames();
      assert.ok(!active.includes(userTool), active.join(', '));
      assert.ok(!active.includes(projectTool), active.join(', '));
    } finally { await session.dispose(); }
  } finally { await f.close(); }
});
