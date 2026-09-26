import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Settings } from '@gajae-code/coding-agent/config/settings';
import { createTools } from '@gajae-code/coding-agent/tools';
import { BUILTIN_TOOLS, HIDDEN_TOOLS } from '@gajae-code/coding-agent/tools/descriptors';

import { applyGjcCompactionPolicy, applyGjcToolSettingsPolicy } from './gjc-bun-sdk-adapter.js';
import { GJC_AGENT_TOOL_NAMES, GJC_AGENT_TOOLS_WITHHELD } from './gjc-agent-tools.js';

/*
 * The app does not build tools; it chooses which of the runtime's to turn on.
 * That makes both directions of drift possible, and both are quiet:
 *
 * - an enabled name that stops existing is silently dropped by the runtime,
 *   so a capability disappears with nothing to show for it;
 * - a withheld name that stops existing leaves a rule guarding nothing, which
 *   reads as a considered decision long after it stopped being one.
 *
 * A bun test because the package cannot be imported from node at all.
 */

test('every enabled tool exists in the runtime', () => {
  for (const name of GJC_AGENT_TOOL_NAMES) {
    assert.equal(
      name in BUILTIN_TOOLS || name in HIDDEN_TOOLS,
      true,
      `${name} is enabled but the runtime has no such tool`,
    );
  }
});

test('every withheld tool exists in the runtime and stays off', () => {
  for (const [name, reason] of Object.entries(GJC_AGENT_TOOLS_WITHHELD)) {
    assert.equal(
      name in BUILTIN_TOOLS,
      true,
      `${name} is withheld but no longer exists; drop the stale rule`,
    );
    assert.equal(
      GJC_AGENT_TOOL_NAMES.includes(name),
      false,
      `${name} is both enabled and withheld`,
    );
    assert.ok(reason.length > 20, `${name} needs a real reason, not a placeholder`);
  }
});

test('every runtime builtin has exactly one recorded policy decision', () => {
  for (const name of Object.keys(BUILTIN_TOOLS)) {
    const occurrences = Number(GJC_AGENT_TOOL_NAMES.includes(name))
      + Number(name in GJC_AGENT_TOOLS_WITHHELD);
    assert.equal(
      occurrences,
      1,
      `${name} has no single tool-policy decision; record it as enabled or withheld`,
    );
  }
});

test('the SDK settings policy keeps the user\u2019s own tool and MCP settings, as the CLI does', () => {
  const settings = Settings.isolated({
    'goal.enabled': true,
    'astEdit.enabled': true,
    'tools.discoveryMode': 'all',
    'mcp.discoveryMode': true,
    'mcp.enableProjectConfig': true,
  });

  applyGjcToolSettingsPolicy(settings);

  // Goal mode alone is decided per run by the adapter, for a view with controls.
  assert.equal(settings.get('goal.enabled'), false);
  assert.equal(settings.get('astEdit.enabled'), true);
  assert.equal(settings.get('tools.discoveryMode'), 'all');
  assert.equal(settings.get('mcp.discoveryMode'), true);
  assert.equal(settings.get('mcp.enableProjectConfig'), true);
  // An unset project-MCP setting stays unset, which the runtime reads as on.
  const untouched = Settings.isolated({});
  applyGjcToolSettingsPolicy(untouched);
  assert.equal(untouched.has('mcp.enableProjectConfig'), false);
});

/*
 * The runtime ships adaptive compaction off for backward compatibility, and the
 * static fallback only fires near `contextWindow - reserve`. On a 1M-token
 * model that is ~850K, which a long app session never reaches while resending
 * its whole prefix every turn - the measured failure was $125 of cache reads in
 * one 681-turn run. The app cannot leave that to a default it tells users not
 * to edit, so these assert the app turns it on and keeps its hands off a user
 * who already decided.
 */

test('adaptive compaction is on for a session that configured none', () => {
  const settings = Settings.isolated({});

  assert.equal(settings.get('compaction.adaptive.enabled'), false, 'runtime default changed; revisit this policy');

  applyGjcCompactionPolicy(settings);

  assert.equal(settings.get('compaction.adaptive.enabled'), true);
  assert.equal(settings.get('compaction.adaptive.baseThresholdPercent'), 75);
  assert.equal(settings.get('compaction.adaptive.aggression'), 0.2);
  assert.equal(settings.get('compaction.adaptive.minThresholdPercent'), 50);
  assert.equal(settings.get('compaction.adaptive.turnWindow'), 15);
});

test('a user who configured compaction keeps every value they set', () => {
  const settings = Settings.isolated({
    'compaction.adaptive.enabled': false,
    'compaction.adaptive.baseThresholdPercent': 90,
    'compaction.adaptive.aggression': 0.5,
    'compaction.adaptive.minThresholdPercent': 60,
    'compaction.adaptive.turnWindow': 30,
  });

  applyGjcCompactionPolicy(settings);

  assert.equal(settings.get('compaction.adaptive.enabled'), false);
  assert.equal(settings.get('compaction.adaptive.baseThresholdPercent'), 90);
  assert.equal(settings.get('compaction.adaptive.aggression'), 0.5);
  assert.equal(settings.get('compaction.adaptive.minThresholdPercent'), 60);
  assert.equal(settings.get('compaction.adaptive.turnWindow'), 30);
});

test('a partially configured session keeps its own value and gets the rest', () => {
  const settings = Settings.isolated({ 'compaction.adaptive.baseThresholdPercent': 60 });

  applyGjcCompactionPolicy(settings);

  assert.equal(settings.get('compaction.adaptive.baseThresholdPercent'), 60);
  assert.equal(settings.get('compaction.adaptive.enabled'), true);
  assert.equal(settings.get('compaction.adaptive.minThresholdPercent'), 50);
});

test('the compaction policy leaves the tool boundary alone', () => {
  const settings = Settings.isolated({ 'goal.enabled': true, 'astEdit.enabled': true });

  applyGjcCompactionPolicy(settings);

  assert.equal(settings.get('goal.enabled'), true);
  assert.equal(settings.get('astEdit.enabled'), true);
});

/*
 * The decision has to survive the runtime that acts on it. `createTools` adds
 * `goal` from `goal.enabled`, which is how goal mode once ran in every browser
 * session while a list said it was withheld; building the tools the way a
 * session does is the only way to see what actually comes out.
 *
 * Deliberately permissive settings: everything a user could turn on is on,
 * and only the structurally withheld tools may be missing.
 */
test('real tool construction yields the CLI tool set minus only the withheld tools', async () => {
  const settings = Settings.isolated({
    'goal.enabled': true,
    'astEdit.enabled': true,
    'astGrep.enabled': true,
    'recipe.enabled': true,
    'calc.enabled': true,
    'checkpoint.enabled': true,
    'renderMermaid.enabled': true,
    'tools.discoveryMode': 'all',
  });
  applyGjcToolSettingsPolicy(settings);

  const tools = await createTools(
    // The fields `createTools` reads. `skipPythonPreflight` keeps the eval
    // backend probe from shelling out during a unit test.
    { cwd: process.cwd(), hasUI: true, skipPythonPreflight: true, settings } as never,
    [...GJC_AGENT_TOOL_NAMES],
  );
  const built = tools.map((tool) => tool.name);

  for (const name of built) {
    assert.equal(
      name in GJC_AGENT_TOOLS_WITHHELD,
      false,
      `${name} is withheld but the runtime built it anyway: ${GJC_AGENT_TOOLS_WITHHELD[name]}`,
    );
    assert.ok(GJC_AGENT_TOOL_NAMES.includes(name), `${name} was built without a policy entry`);
  }

  // What the CLI would give a user with these settings, and what used to be
  // withheld in the app, all materialize. (`skill` and `search_tool_bm25` need
  // a live session's skill registry and discovery hooks, which this bare tool
  // session does not carry.)
  for (const name of [
    'bash', 'read', 'edit', 'search', 'find', 'write', 'ask',
    'ast_edit', 'eval', 'python', 'calc', 'bisect', 'render_mermaid', 'checkpoint', 'rewind', 'resolve',
  ]) {
    assert.ok(built.includes(name), `${name} did not survive construction`);
  }
});

test('the core coding loop is never accidentally dropped', () => {
  // Losing one of these would not fail anything else in this file.
  for (const name of ['bash', 'read', 'write', 'edit', 'search', 'find']) {
    assert.equal(GJC_AGENT_TOOL_NAMES.includes(name), true, `${name} must stay enabled`);
  }
});

test('tools that reach outside this machine are offered as in the CLI', () => {
  // Their own availability rules (a configured SSH host, Telegram setup, the
  // gh CLI) decide whether they appear, exactly as in a CLI session.
  for (const name of ['ssh', 'telegram_send', 'irc', 'github']) {
    assert.equal(GJC_AGENT_TOOL_NAMES.includes(name), true, `${name} must be requested`);
    assert.equal(name in GJC_AGENT_TOOLS_WITHHELD, false, name);
  }
});

test('only tools the per-turn session lifetime or the project binding cannot carry are withheld', () => {
  assert.deepEqual(Object.keys(GJC_AGENT_TOOLS_WITHHELD).sort(), ['cron', 'goal', 'job', 'monitor', 'move_session']);
});

test('browser and computer use the app-owned automation transports', () => {
  assert.equal(GJC_AGENT_TOOL_NAMES.includes('browser'), true);
  assert.equal(GJC_AGENT_TOOL_NAMES.includes('computer'), true);
  assert.equal('browser' in GJC_AGENT_TOOLS_WITHHELD, false);
  assert.equal('computer' in GJC_AGENT_TOOLS_WITHHELD, false);
});

test('the skill tool is on, because the app advertises skills', () => {
  // The slash menu lists bundled skills; without this tool `/skill:<name>`
  // reaches the model as bare text and never activates.
  assert.equal(GJC_AGENT_TOOL_NAMES.includes('skill'), true);
});
