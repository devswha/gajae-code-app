import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Settings } from '@gajae-code/coding-agent/config/settings';
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
  });

  applyGjcToolSettingsPolicy(settings);

  assert.equal(settings.get('goal.enabled'), false);
  assert.equal(settings.get('astEdit.enabled'), false);
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
