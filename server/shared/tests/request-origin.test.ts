import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import test from 'node:test';

import { isAllowedRequestOrigin } from '@/shared/request-origin.js';

/*
 * This server runs shell commands for its owner and binds loopback, which does
 * nothing to keep other websites away from it: neither a WebSocket handshake
 * nor a simple cross-origin request is stopped by the same-origin policy. The
 * cases below are the ones that decide whether a page the owner happens to
 * visit can read their transcripts and start a turn.
 */

const loopback = { hostHeader: '127.0.0.1:3001', allowedHosts: undefined } as const;

test('a remote site is rejected even though the server is on loopback', () => {
  assert.equal(isAllowedRequestOrigin('https://evil.example', loopback), false);
  assert.equal(isAllowedRequestOrigin('http://evil.example:3001', loopback), false);
});

test('a lookalike hostname does not pass as loopback', () => {
  // Registrable names that merely contain the digits, and the trailing-dot
  // absolute form of a foreign domain.
  assert.equal(isAllowedRequestOrigin('https://127.0.0.1.evil.example', loopback), false);
  assert.equal(isAllowedRequestOrigin('https://localhost.evil.example', loopback), false);
});

test('the opaque origin is rejected', () => {
  // Sandboxed iframes, file:// and data: documents all send this.
  assert.equal(isAllowedRequestOrigin('null', loopback), false);
});

test('a malformed origin is rejected rather than guessed at', () => {
  assert.equal(isAllowedRequestOrigin('not a url', loopback), false);
  assert.equal(isAllowedRequestOrigin('://', loopback), false);
});

test('a missing origin is allowed for a permitted Host, including same-origin browser GETs', () => {
  assert.equal(isAllowedRequestOrigin(undefined, loopback), true);
  assert.equal(isAllowedRequestOrigin('', loopback), true);
});

test('matching Host and Origin cannot bypass an explicitly configured DNS host list', () => {
  const policy = { hostHeader: 'attacker.example:3001', allowedHosts: ['studio.example'] };
  assert.equal(isAllowedRequestOrigin('http://attacker.example:3001', policy), false);
  assert.equal(isAllowedRequestOrigin(undefined, policy), false);
  assert.equal(isAllowedRequestOrigin('', policy), false);
  assert.equal(isAllowedRequestOrigin('https://studio.example', policy), false);
});

test('unconfigured DNS domains fail closed even with a matching HTTPS Origin', () => {
  const policy = { hostHeader: 'published.example', allowedHosts: undefined };
  assert.equal(isAllowedRequestOrigin('https://published.example', policy), false);
  assert.equal(isAllowedRequestOrigin('http://published.example', policy), false);
  assert.equal(isAllowedRequestOrigin(undefined, policy), false);
  assert.equal(isAllowedRequestOrigin('https://other.example', policy), false);
});

test('the dev client on another port is allowed', () => {
  // Vite serves the UI on 5173 and proxies to 3001, forwarding the original
  // Origin. Comparing ports would break every development session.
  assert.equal(isAllowedRequestOrigin('http://localhost:5173', loopback), true);
  assert.equal(isAllowedRequestOrigin('http://127.0.0.1:5173', loopback), true);
});

test('loopback spellings are interchangeable', () => {
  assert.equal(isAllowedRequestOrigin('http://localhost:3001', loopback), true);
  assert.equal(
    isAllowedRequestOrigin('http://127.0.0.1:3001', { hostHeader: 'localhost:3001', allowedHosts: undefined }),
    true,
  );
});

test('the same host on a non-loopback address is allowed', () => {
  const tailnet = { hostHeader: '100.78.133.28:3001', allowedHosts: undefined } as const;

  assert.equal(isAllowedRequestOrigin('http://100.78.133.28:5173', tailnet), true);
  assert.equal(isAllowedRequestOrigin('http://100.78.133.29:5173', tailnet), false);
});

test('a name the owner listed in ALLOWED_HOSTS is admitted', () => {
  const policy = { hostHeader: '127.0.0.1:3001', allowedHosts: ['studio.example'] } as const;

  assert.equal(isAllowedRequestOrigin('https://studio.example', policy), true);
  assert.equal(isAllowedRequestOrigin('https://other.example', policy), false);
});

test('the leading-dot form covers subdomains, exactly as it does for Vite', () => {
  const policy = { hostHeader: '127.0.0.1:3001', allowedHosts: ['.tail1e211e.ts.net'] } as const;

  assert.equal(isAllowedRequestOrigin('https://mac.tail1e211e.ts.net', policy), true);
  assert.equal(isAllowedRequestOrigin('https://tail1e211e.ts.net', policy), true);
  // The suffix must be a real label boundary, not a string match.
  assert.equal(isAllowedRequestOrigin('https://eviltail1e211e.ts.net', policy), false);
});

test('ALLOWED_HOSTS=* removes the check, because the owner asked for that', () => {
  const policy = { hostHeader: '127.0.0.1:3001', allowedHosts: true } as const;

  assert.equal(isAllowedRequestOrigin('https://anything.example', policy), true);
  // Not even a wildcard admits the opaque origin: nothing legitimate sends it.
  assert.equal(isAllowedRequestOrigin('null', policy), false);
});

test('reaching the app on this machine own LAN or tailnet address works unconfigured', () => {
  // Vite proxies to `localhost`, so the Host the server sees is never the
  // address the browser used. Requiring configuration for the case that works
  // today with none would be a regression dressed up as hardening.
  const external = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal);

  if (!external) return; // A host with no external interface has nothing to assert.

  assert.equal(
    isAllowedRequestOrigin(`http://${external.address}:5173`, loopback),
    true,
  );
});

test('an address this machine does not hold is still foreign', () => {
  // 198.51.100.0/24 is reserved for documentation and can never be a local
  // interface, so this stays a negative case on every machine.
  assert.equal(isAllowedRequestOrigin('http://198.51.100.7:5173', loopback), false);
});

test('missing or malformed Host headers cannot borrow trust from a listed Origin', () => {
  for (const hostHeader of [undefined, '', 'studio.example/path', 'attacker.example@studio.example', 'studio.example?x', 'studio.example#x', 'studio.example:bad']) {
    const policy = { hostHeader, allowedHosts: ['studio.example'] };
    assert.equal(isAllowedRequestOrigin('https://studio.example', policy), false, String(hostHeader));
    assert.equal(isAllowedRequestOrigin(undefined, policy), false, String(hostHeader));
  }
});
