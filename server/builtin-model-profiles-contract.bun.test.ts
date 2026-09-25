import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILTIN_MODEL_PROFILES } from '@gajae-code/coding-agent/config/model-profiles';

import { GJC_BUILTIN_MODEL_PROFILES } from './modules/providers/list/gjc/gjc-builtin-model-profiles.js';

/*
 * The Node sidecar cannot import the runtime's profile module (it pulls in
 * Bun-only utilities), so the app keeps a copy for the preset picker. The copy
 * drifted silently across SDK bumps: presets the runtime shipped were missing
 * from the picker and existing presets advertised models the runtime no longer
 * ran. A bun test because the runtime cannot be imported from node.
 *
 * Outside the `server/gjc-*` namespace for the same reason as
 * tool-configs-contract: it asserts an application claim about the picker's
 * copy, so it stays with the application if the engine moves out.
 */

const ROLES = ['default', 'planner', 'executor', 'architect', 'critic'] as const;

const sdkProfiles = BUILTIN_MODEL_PROFILES;

test('the app carries every runtime built-in preset, in runtime order', () => {
  assert.deepEqual(
    GJC_BUILTIN_MODEL_PROFILES.map((profile) => profile.name),
    sdkProfiles.map((profile) => profile.name),
  );
});

test('each preset role names the first model of the runtime chain', () => {
  const copies = new Map(GJC_BUILTIN_MODEL_PROFILES.map((profile) => [profile.name, profile]));
  for (const sdk of sdkProfiles) {
    const expected: Record<string, string> = {};
    for (const role of ROLES) {
      const selector = sdk.modelMapping[role];
      if (selector === undefined) continue;
      expected[role] = typeof selector === 'string' ? selector : selector[0];
    }
    assert.deepEqual({ ...copies.get(sdk.name)?.roles }, expected, `roles of ${sdk.name}`);
  }
});

test('every preset has an app-authored label and group', () => {
  for (const profile of GJC_BUILTIN_MODEL_PROFILES) {
    assert.ok(profile.label.trim(), `label of ${profile.name}`);
    assert.ok(profile.group.trim(), `group of ${profile.name}`);
  }
});
