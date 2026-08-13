import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILTIN_TOOLS } from '@gajae-code/coding-agent/tools/descriptors';

import { TOOL_CONFIGS } from '../src/components/chat/tools/configs/toolConfigs.js';

import { GJC_AGENT_TOOL_NAMES } from './gjc-agent-tools.js';

/*
 * Tool display configs are keyed by the name that arrives on
 * `tool_execution_start`, which is the tool's own `name` — lowercase, as the
 * runtime defines it.
 *
 * The registry was keyed by Claude Code's names instead (Bash, Read, Grep,
 * Glob, TodoWrite), so every GJC tool call missed it and rendered as a raw
 * JSON dump through `Default`. Nothing failed; the cards just quietly went
 * generic. This is the test that would have caught it.
 *
 * A bun test because the runtime cannot be imported from node.
 */

/** Keys that are not runtime tool names, each for a stated reason. */
const NON_RUNTIME_KEYS: Readonly<Record<string, string>> = {
  Default: 'The fallback config for anything unregistered.',
  AskUserQuestion: 'The label gjc-sdk-bridge.ts gives a question; the worker sends `ask`.',
  exit_plan_mode: 'Plan-mode payload rendered inline by PlanDisplay, not a builtin tool.',
  ExitPlanMode: 'Legacy casing of the same plan-mode payload.',
};

test('every configured tool name is one the runtime actually sends', () => {
  for (const key of Object.keys(TOOL_CONFIGS)) {
    if (key in NON_RUNTIME_KEYS) continue;
    assert.equal(
      key in BUILTIN_TOOLS,
      true,
      `${key} has a display config but is not a runtime tool; its config is dead`,
    );
  }
});

test('every non-runtime key is documented and really is absent from the runtime', () => {
  for (const [key, reason] of Object.entries(NON_RUNTIME_KEYS)) {
    assert.equal(key in TOOL_CONFIGS, true, `${key} is documented but no longer configured`);
    assert.equal(
      key in BUILTIN_TOOLS,
      false,
      `${key} is now a real tool; drop the exemption so it is checked like the rest`,
    );
    assert.ok(reason.length > 20, `${key} needs a real reason`);
  }
});

test('the tools most calls go through have a config rather than the JSON fallback', () => {
  // Not every enabled tool needs bespoke display, but these carry the bulk of
  // the traffic and are unreadable as raw parameters.
  for (const name of ['bash', 'read', 'write', 'search', 'find']) {
    assert.equal(GJC_AGENT_TOOL_NAMES.includes(name), true, `${name} should be enabled`);
    assert.equal(name in TOOL_CONFIGS, true, `${name} falls back to the JSON dump`);
  }
});

test('the question config is shared, not duplicated', () => {
  assert.equal(TOOL_CONFIGS.ask, TOOL_CONFIGS.AskUserQuestion);
});
