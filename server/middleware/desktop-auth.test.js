import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopAuth,
  DESKTOP_AUTH_COOKIE_NAME,
  DESKTOP_BOOTSTRAP_PATH,
} from './desktop-auth.js';

const secret = 'a'.repeat(64);
const nonce = 'b'.repeat(64);
const server = { address: () => ({ port: 43123 }) };
const env = {
  GJC_DESKTOP: '1',
  GJC_DESKTOP_API_KEY: secret,
  GJC_DESKTOP_BOOTSTRAP_NONCE: nonce,
};

const response = () => {
  const state = { statusCode: null, body: null, cookie: null, redirect: null };
  return {
    state,
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
    cookie(name, value, options) { state.cookie = { name, value, options }; return this; },
    redirect(code, location) { state.redirect = { code, location }; return this; },
  };
};

const request = (headers = {}) => ({ headers });

test('desktop bootstrap rejects incorrect nonce, consumes the correct nonce, and never returns either secret', () => {
  const auth = createDesktopAuth({ env, server });
  const rejected = response();
  auth.bootstrap({ method: 'GET', query: { nonce: 'wrong' } }, rejected);
  assert.equal(rejected.state.statusCode, 401);
  assert.equal(JSON.stringify(rejected.state).includes(secret), false);
  assert.equal(JSON.stringify(rejected.state).includes(nonce), false);

  const bootstrapped = response();
  auth.bootstrap({ method: 'GET', query: { nonce } }, bootstrapped);
  assert.deepEqual(bootstrapped.state.redirect, { code: 303, location: '/' });
  assert.equal(bootstrapped.state.cookie.name, DESKTOP_AUTH_COOKIE_NAME);
  assert.equal(bootstrapped.state.cookie.value, secret);
  assert.deepEqual(bootstrapped.state.cookie.options, { httpOnly: true, sameSite: 'lax', path: '/' });
  assert.equal(DESKTOP_BOOTSTRAP_PATH.includes('?'), false);

  const replay = response();
  auth.bootstrap({ method: 'GET', query: { nonce } }, replay);
  assert.equal(replay.state.statusCode, 401);
});

test('desktop HTTP and WebSocket authentication require the launch cookie and exact loopback origin', () => {
  const auth = createDesktopAuth({ env, server });
  auth.corsOptions.origin('http://127.0.0.1:43123', (_error, allowed) => assert.equal(allowed, true));
  auth.corsOptions.origin('http://127.0.0.1:43124', (_error, allowed) => assert.equal(allowed, false));
  const goodHeaders = {
    origin: 'http://127.0.0.1:43123',
    cookie: `${DESKTOP_AUTH_COOKIE_NAME}=${secret}`,
  };
  let advanced = false;
  auth.authenticateHttp(request(goodHeaders), response(), () => { advanced = true; });
  assert.equal(advanced, true);
  assert.equal(auth.authenticateWebSocket(request(goodHeaders)), true);

  // Same-origin browser GET fetches omit the Origin header; the cookie alone
  // must authenticate HTTP while WebSocket handshakes still require Origin.
  let cookieOnlyAdvanced = false;
  auth.authenticateHttp(request({ cookie: goodHeaders.cookie }), response(), () => { cookieOnlyAdvanced = true; });
  assert.equal(cookieOnlyAdvanced, true);
  assert.equal(auth.authenticateWebSocket(request({ cookie: goodHeaders.cookie })), false);

  for (const headers of [
    { origin: goodHeaders.origin },
    { origin: goodHeaders.origin, cookie: `${DESKTOP_AUTH_COOKIE_NAME}=wrong` },
    { origin: 'http://127.0.0.1:43124', cookie: goodHeaders.cookie },
  ]) {
    const rejected = response();
    let nextCalled = false;
    auth.authenticateHttp(request(headers), rejected, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(rejected.state.statusCode, 401);
    assert.equal(auth.authenticateWebSocket(request(headers)), false);
  }
  const pageRejected = response();
  auth.authenticatePage(request(), pageRejected, () => { throw new Error('missing cookie must not advance'); });
  assert.equal(pageRejected.state.statusCode, 401);
  let pageAdvanced = false;
  auth.authenticatePage(request({ cookie: goodHeaders.cookie }), response(), () => { pageAdvanced = true; });
  assert.equal(pageAdvanced, true);
});

test('desktop auth adapter is inert when desktop mode is unset', () => {
  const auth = createDesktopAuth({ env: {}, server });
  let advanced = false;
  auth.authenticateHttp(request(), response(), () => { advanced = true; });
  assert.equal(advanced, true);
  assert.equal(auth.authenticateWebSocket(request()), true);
  let pageAdvanced = false;
  auth.authenticatePage(request(), response(), () => { pageAdvanced = true; });
  assert.equal(pageAdvanced, true);
  assert.equal(auth.corsOptions, null);
});
