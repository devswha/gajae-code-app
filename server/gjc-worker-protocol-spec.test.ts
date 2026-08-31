import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GJC_WORKER_EVENT_METHODS,
  GJC_WORKER_MAX_FRAME_BYTES,
  GJC_WORKER_PROTOCOL_VERSION,
  GJC_WORKER_REQUEST_METHODS,
  parseGjcWorkerFrame,
} from '@/gjc-worker-protocol.js';

/*
 * The published specification has to describe this implementation, not a past
 * one.
 *
 * `docs/GJC-WORKER-PROTOCOL.md` exists so a third party can implement either
 * side of this interface without reading our source - which is also what makes
 * the worker a separate program rather than half of this one. A specification
 * that quietly drifts from the code is worse than none: it produces
 * implementations that fail in ways neither side can explain, and it is
 * evidence of an interface nobody maintains.
 *
 * The older summary in `server/GJC-LIVE-SPEC.md` had already gone stale - it
 * listed neither `turn.steer` nor any `oauth.*` method - which is exactly the
 * drift this test exists to make impossible.
 */

const SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'GJC-WORKER-PROTOCOL.md');
const spec = readFileSync(SPEC_PATH, 'utf8');

/** Method names and their documented scope, read out of the tables in section 4. */
function documentedMethods(heading: string): Map<string, string> {
  const section = spec.slice(spec.indexOf(`### ${heading}`) + heading.length + 4);
  // Stop at the next heading of any level: the two method tables are siblings
  // under one `##`, so slicing to the next `##` would merge them.
  const end = section.search(/\n#{2,3} /u);
  const table = end === -1 ? section : section.slice(0, end);
  const rows = new Map<string, string>();
  for (const line of table.split('\n')) {
    const match = /^\|\s*`([a-z][a-z.]*)`\s*\|\s*\*{0,2}([a-z]+)\*{0,2}\s*\|/u.exec(line);
    if (match) rows.set(match[1], match[2]);
  }
  return rows;
}

const documentedRequests = documentedMethods('Requests');
const documentedEvents = documentedMethods('Events');

test('every request method the code accepts is documented', () => {
  for (const method of GJC_WORKER_REQUEST_METHODS) {
    assert.ok(documentedRequests.has(method), `${method} is missing from the specification's request table`);
  }
});

test('every documented request method exists in the code', () => {
  // The other direction: a method removed from the protocol leaves a table row
  // describing an interface nobody implements.
  for (const method of documentedRequests.keys()) {
    assert.ok(
      (GJC_WORKER_REQUEST_METHODS as readonly string[]).includes(method),
      `the specification documents ${method}, which the protocol no longer accepts`,
    );
  }
});

test('every event method the code emits is documented, and no more', () => {
  for (const method of GJC_WORKER_EVENT_METHODS) {
    assert.ok(documentedEvents.has(method), `${method} is missing from the specification's event table`);
  }
  for (const method of documentedEvents.keys()) {
    assert.ok(
      (GJC_WORKER_EVENT_METHODS as readonly string[]).includes(method),
      `the specification documents ${method}, which the protocol no longer emits`,
    );
  }
});

test('the documented scope of every method is the scope the codec enforces', () => {
  // Probed rather than asserted from a second copy of the list: the codec is the
  // authority on whether a method may carry sessionId, so ask it.
  const acceptsSessionId = (kind: 'request' | 'event', method: string): boolean => {
    const frame = {
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind,
      id: 'probe',
      method,
      sessionId: 'session-probe',
      payload: {},
    };
    try {
      parseGjcWorkerFrame(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  };

  for (const [method, scope] of documentedRequests) {
    assert.equal(
      acceptsSessionId('request', method),
      scope === 'scoped',
      `${method} is documented as ${scope} but the codec disagrees`,
    );
  }
  for (const [method, scope] of documentedEvents) {
    // `worker.status` is the one method whose scope is optional, so it accepts a
    // sessionId while not requiring one.
    if (scope === 'optional') {
      assert.equal(acceptsSessionId('event', method), true, `${method} should accept an optional sessionId`);
      continue;
    }
    assert.equal(
      acceptsSessionId('event', method),
      scope === 'scoped',
      `${method} is documented as ${scope} but the codec disagrees`,
    );
  }
});

test('the constants the specification quotes are the constants in force', () => {
  assert.match(
    spec,
    new RegExp(`protocol, version ${GJC_WORKER_PROTOCOL_VERSION}\\b`, 'iu'),
    'the specification title states a different protocol version',
  );
  assert.ok(
    spec.includes(GJC_WORKER_MAX_FRAME_BYTES.toLocaleString('en-US')),
    `the specification does not state the real frame ceiling (${GJC_WORKER_MAX_FRAME_BYTES})`,
  );
});

test('every protocol error code the specification lists is one the codec raises', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'gjc-worker-protocol.ts'), 'utf8');
  const raised = new Set<string>();
  for (const line of source.split('\n')) {
    if (!line.includes('fail(')) continue;
    // Every code on the line, not just one directly after `fail(`: the
    // identifier codes are chosen by a ternary inside the call. Requiring an
    // underscore separates a code from the comparison values beside it - every
    // code has one, `'id'` and `'sessionId'` do not.
    for (const literal of line.matchAll(/'([a-z]+(?:_[a-z]+)+)'/gu)) raised.add(literal[1]);
  }
  // Raised by the request tracker's constructor rather than through `fail`.
  raised.add('worker_exited');

  // Only the first cell of a table row. Prose in the same section backticks
  // envelope fields such as `kind`, which are not error codes.
  const errorTable = spec.slice(spec.indexOf('## 7. Errors'), spec.indexOf('## 8.'));
  const documented = new Set<string>();
  for (const line of errorTable.split('\n')) {
    const cell = /^\|([^|]+)\|/u.exec(line)?.[1];
    if (!cell) continue;
    for (const code of cell.matchAll(/`([a-z_]+)`/gu)) documented.add(code[1]);
  }

  for (const code of documented) {
    assert.ok(raised.has(code), `the specification documents error ${code}, which nothing raises`);
  }
  for (const code of raised) {
    assert.ok(documented.has(code), `${code} is raised but absent from the specification's error table`);
  }
});
