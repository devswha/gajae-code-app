import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { SDK_EVENT_FIELDS_READ } from './gjc-bun-sdk-events.js';

/*
 * Drift guard for the SDK event payloads the bun fan-in reads.
 *
 * `forwardSdkEvent` receives events as `unknown`, so a renamed upstream field
 * does not fail typecheck and does not fail a unit test written against the same
 * wrong assumption — it just makes the mapping emit nothing, and a tool card
 * renders blank in production. The SDK's own declarations cannot be imported as
 * types here (their relative re-exports are extensionless and do not resolve
 * under NodeNext, which collapses `AgentSessionEvent` to `any`), so this test
 * reads the shipped declarations as text instead.
 *
 * On an SDK bump this is the test that fails first when an event payload is
 * renamed. Fix `SDK_EVENT_FIELDS_READ` and the mapping together.
 */

// Resolved through this repo's own node_modules on purpose. The app pins its
// SDK independently of any globally installed `gjc`, and comparing against a
// global install is how phantom "drift" gets reported.
const repoModules = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');

function declarationSource(packageName: string, relativePath: string): string {
  return readFileSync(path.join(repoModules, packageName, relativePath), 'utf8');
}

/** Extracts the `{ type: "<name>"; ... }` union member for one event type. */
function eventMemberBody(source: string, eventType: string): string | null {
  const marker = new RegExp(`type\\s*:\\s*"${eventType}"`, 'u');
  const match = marker.exec(source);
  if (!match) return null;
  // Walk back to the object literal's opening brace, then forward to its match.
  const open = source.lastIndexOf('{', match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return null;
}

const sessionEvents = declarationSource('@gajae-code/coding-agent', 'dist/types/session/agent-session.d.ts');
const coreEvents = declarationSource('@gajae-code/agent-core', 'dist/types/types.d.ts');

test('the SDK declarations that back the fan-in are present and readable', () => {
  assert.match(sessionEvents, /export type AgentSessionEvent/u);
  assert.match(coreEvents, /type\s*:\s*"tool_execution_start"/u);
});

for (const [eventType, fields] of Object.entries(SDK_EVENT_FIELDS_READ)) {
  test(`SDK event ${eventType} still declares every field the fan-in reads`, () => {
    const body = eventMemberBody(sessionEvents, eventType) ?? eventMemberBody(coreEvents, eventType);
    assert.ok(body, `the SDK no longer declares an event of type "${eventType}"`);

    for (const field of fields) {
      assert.match(
        body,
        new RegExp(`(?:^|[{;\\n])\\s*(?:/\\*\\*[\\s\\S]*?\\*/\\s*)?${field}\\??\\s*:`, 'u'),
        `SDK event "${eventType}" no longer declares "${field}"; gjc-bun-sdk-events.ts reads it and would silently emit nothing`,
      );
    }
  });
}

test('the fan-in table rejects fields the SDK never declared', () => {
  // Proves the assertion above can actually fail, rather than matching anything.
  const body = eventMemberBody(sessionEvents, 'auto_retry_end');
  assert.ok(body);
  assert.doesNotMatch(body, /(?:^|[{;\n])\s*succeeded\??\s*:/u, 'auto_retry_end uses `success`, not `succeeded`');
  assert.match(body, /(?:^|[{;\n])\s*success\s*:/u);
});
