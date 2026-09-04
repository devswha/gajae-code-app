import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILTIN_TOOLS } from '@gajae-code/coding-agent/tools/descriptors';
import { TOOL_CATALOG } from '@gajae-code/coding-agent/tools/tool-catalog.generated';

import { TOOL_CONFIGS, rendersCommandRow } from '../src/components/chat/tools/configs/toolConfigs.js';

import { GJC_AGENT_TOOL_NAMES } from './gjc-engine.js';

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
 *
 * Lives outside the `server/gjc-*` namespace on purpose. It asserts an
 * *application* claim - that the chat tool cards are keyed the way the runtime
 * names its tools - so it belongs with the application when the engine moves to
 * its own repository. Under the engine's name it would have travelled with the
 * engine and taken an import of `src/` with it.
 */

/** Keys that are not runtime tool names, each for a stated reason. */
const NON_RUNTIME_KEYS: Readonly<Record<string, string>> = {
  Default: 'The fallback config for anything unregistered.',
  AskUserQuestion: 'The label gjc-sdk-bridge.ts gives a question; the worker sends `ask`.',
  exit_plan_mode: 'Plan-mode payload rendered inline by PlanDisplay, not a builtin tool.',
  ExitPlanMode: 'Legacy casing of the same plan-mode payload.',
  apply_patch: 'The wire name the edit tool takes in apply_patch mode (its customWireName); the same config as edit.',
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

/*
 * `edit` exposes itself to the GPT-5 family as `apply_patch` (EditTool's
 * `customWireName`), and that is the name a call arrives under. The card must
 * be the edit card, and the exemption above must keep describing a name the
 * runtime really uses - if the runtime ever registers it as a tool of its own,
 * the exemption test fails and the key gets checked like the rest.
 */
test('apply_patch is the edit tool under its wire name', async () => {
  const { EditTool } = await import('@gajae-code/coding-agent/edit');
  assert.equal(TOOL_CONFIGS.apply_patch, TOOL_CONFIGS.edit);
  const wireName = Object.getOwnPropertyDescriptor(EditTool.prototype, 'customWireName');
  assert.ok(wireName?.get, 'EditTool declares a customWireName getter');
  assert.match(String(wireName.get), /apply_patch/, 'the wire name is apply_patch');
});

/**
 * Fields a config reads that the runtime schema does not declare, each because
 * the app itself writes them onto the input before rendering.
 */
const APP_WRITTEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  ask: ['answers'],
  // `computer` is a discriminated union of one schema per action, which the
  // generated catalog flattens to no properties at all. These are the fields
  // its union members declare.
  computer: ['action', 'actions', 'text', 'keys'],
};

/** Records every field an accessor touches, and answers undefined to all of them. */
function recordingInput(seen: Set<string>): Record<string, unknown> {
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property === 'string') seen.add(property);
      return undefined;
    },
    has: () => true,
  });
}

/*
 * Names matching is not the same as fields matching. `todo_write` was keyed
 * correctly and still rendered an empty card on every call, because its
 * accessors read `phase`/`items`/`task` off the top level while the runtime
 * sends `{ ops: [...] }`. A config that reads a field the tool never sends is
 * as dead as a config under the wrong name, and looks healthier.
 */
test('every config reads fields the runtime actually sends', () => {
  for (const [name, config] of Object.entries(TOOL_CONFIGS)) {
    const entry = (TOOL_CATALOG as Record<string, { parameters?: { properties?: Record<string, unknown> } }>)[name];
    if (!entry) continue; // Non-runtime keys are covered by the tests above.

    const declared = new Set(Object.keys(entry.parameters?.properties ?? {}));
    for (const extra of APP_WRITTEN_FIELDS[name] ?? []) declared.add(extra);

    const seen = new Set<string>();
    const input = recordingInput(seen);
    const accessors = [
      config.input.getValue,
      config.input.getSecondary,
      typeof config.input.title === 'function' ? config.input.title : undefined,
      config.input.getContentProps,
    ];
    for (const accessor of accessors) accessor?.(input);

    for (const field of seen) {
      assert.equal(
        declared.has(field),
        true,
        `${name} reads "${field}", which is not in its runtime schema (${[...declared].join(', ')})`,
      );
    }
  }
});

/*
 * The runtime merges a shell call with its output into one block. The app has
 * the same row, but reached it by matching the literal name `Bash`, which the
 * runtime never sends: a gjc `bash` call rendered as a labelled one-liner with
 * its output repeated underneath as a separate generic card.
 */
test('the shell tool the runtime sends is the one the command row matches', () => {
  assert.equal(GJC_AGENT_TOOL_NAMES.includes('bash'), true);
  assert.equal(rendersCommandRow('bash'), true);
  assert.equal(rendersCommandRow('Bash'), true, 'stored Claude/Codex transcripts still replay through this UI');
  assert.equal(rendersCommandRow('read'), false);
});
