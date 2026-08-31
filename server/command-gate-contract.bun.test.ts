import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACP_BUILTIN_SLASH_COMMANDS } from '@gajae-code/coding-agent/slash-commands/acp-builtins';

import { UNGATED_COMMAND_NAMES } from '../src/components/chat/commandGatePolicy.js';

/*
 * Which slash commands run without a confirmation gate.
 *
 * The allowlist is application policy - the runtime carries no "destructive"
 * marker - but its NAMES belong to the runtime. A renamed or withdrawn command
 * leaves a dead allowlist entry, and dead entries fail in the dangerous
 * direction: they keep asserting "safe" for a name whose behaviour nobody checks
 * any more.
 *
 * The reverse case needs no test. A newly added destructive command is absent
 * from the allowlist and therefore gates by default.
 *
 * This lived in `gjc-sdk-contract.bun.test.ts` until the engine was made
 * separable. It is an application claim checked against the runtime, so it
 * belongs with the application; under an engine filename it would have moved
 * with the engine and carried an import of `src/` across the boundary.
 *
 * A bun test because the runtime cannot be imported from node.
 */
test('every ungated command name still exists in the runtime', () => {
  const runtime = new Set([
    ...ACP_BUILTIN_SLASH_COMMANDS.map((command) => `/${command.name}`),
    // Provider-bundled prompt, advertised by provider-commands.service.
    '/init',
  ]);

  for (const name of new Set<string>(UNGATED_COMMAND_NAMES)) {
    assert.equal(runtime.has(name), true, `${name} is ungated but no longer exists upstream`);
  }
});
