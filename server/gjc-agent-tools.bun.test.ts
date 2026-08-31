import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Settings } from '@gajae-code/coding-agent/config/settings';
import { createTools } from '@gajae-code/coding-agent/tools';
import { BUILTIN_TOOLS } from '@gajae-code/coding-agent/tools/descriptors';

import { applyGjcToolSettingsPolicy } from './gjc-bun-sdk-adapter.js';
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
      name in BUILTIN_TOOLS,
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

test('the SDK settings policy suppresses implicit tool additions', () => {
  const settings = Settings.isolated({
    'goal.enabled': true,
    'astEdit.enabled': true,
    'mcp.discoveryMode': true,
    'mcp.enableProjectConfig': true,
  });

  applyGjcToolSettingsPolicy(settings);

  assert.equal(settings.get('goal.enabled'), false);
  assert.equal(settings.get('astEdit.enabled'), false);
  assert.equal(settings.get('mcp.discoveryMode'), false);
  assert.equal(settings.get('mcp.enableProjectConfig'), false);
});

/*
 * The decision has to survive the runtime that acts on it.
 *
 * The two lists above are a statement of intent; `toolNames` is a seed the
 * runtime adds to. `createTools` appends `ast_grep`, `ast_edit` and `recipe`
 * from settings whose siblings are requested, and `goal` from `goal.enabled` -
 * which is how goal mode ran in every browser session while this file said it
 * was withheld. Asserting on the lists alone cannot see any of that, so this
 * builds the tools the way a session does and asks what actually came out.
 *
 * Deliberately hostile settings: everything a user could turn on is on, and
 * the policy has to win anyway.
 */
test('nothing outside the allowlist survives real tool construction', async () => {
  const settings = Settings.isolated({
    'goal.enabled': true,
    'astEdit.enabled': true,
    'astGrep.enabled': true,
    'recipe.enabled': true,
    'mcp.discoveryMode': true,
    'mcp.enableProjectConfig': true,
  });
  applyGjcToolSettingsPolicy(settings);

  const tools = await createTools(
    // The fields `createTools` reads. `skipPythonPreflight` keeps the eval
    // backend probe from shelling out during a unit test.
    { cwd: process.cwd(), hasUI: false, skipPythonPreflight: true, settings } as never,
    [...GJC_AGENT_TOOL_NAMES],
  );
  const built = tools.map((tool) => tool.name);

  for (const name of built) {
    assert.equal(
      name in GJC_AGENT_TOOLS_WITHHELD,
      false,
      `${name} is withheld but the runtime built it anyway: ${GJC_AGENT_TOOLS_WITHHELD[name]}`,
    );
  }

  // `resolve` is a hidden companion rather than a builtin, so it is in neither
  // list: `createTools` always appends it, and the SDK session then drops it
  // unless some tool is deferrable. With ast_edit forced off nothing is, so it
  // never reaches a browser session - but it is named here rather than left to
  // look like an escape.
  const allowed = new Set([...GJC_AGENT_TOOL_NAMES, 'resolve']);
  for (const name of built) {
    assert.ok(allowed.has(name), `${name} was built without an allowlist entry`);
  }

  // A tool that silently stops materializing is the other direction of drift.
  for (const name of ['bash', 'read', 'edit', 'search', 'find', 'write']) {
    assert.ok(built.includes(name), `${name} did not survive construction`);
  }
});

test('the core coding loop is never accidentally dropped', () => {
  // Losing one of these would not fail anything else in this file.
  for (const name of ['bash', 'read', 'write', 'edit', 'search', 'find']) {
    assert.equal(GJC_AGENT_TOOL_NAMES.includes(name), true, `${name} must stay enabled`);
  }
});

test('unmediated tools that reach outside this machine stay off', () => {
  // The ones whose blast radius is not confined to the session. Named
  // explicitly so widening the set has to argue with this test.
  for (const name of ['ssh', 'telegram_send', 'irc', 'cron']) {
    assert.equal(GJC_AGENT_TOOL_NAMES.includes(name), false, `${name} must not be enabled`);
    assert.ok(name in GJC_AGENT_TOOLS_WITHHELD, `${name} must carry a written reason`);
  }
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
