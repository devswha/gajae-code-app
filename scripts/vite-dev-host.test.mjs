import assert from 'node:assert/strict';
import test from 'node:test';

import { developmentServer } from '../vite.config.js';

/*
 * The dev server proxies /api, /ws and /shell to the API on loopback - a server
 * that runs shell commands for its owner. Which interfaces that proxy listens
 * on is therefore an exposure decision, not a convenience default.
 */

test('the dev server binds loopback unless a host is named', () => {
  const server = developmentServer({});
  assert.equal(server.host, 'localhost');
});

test('an explicit host is still honoured, including the wildcard', () => {
  assert.equal(developmentServer({ HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(developmentServer({ HOST: '100.64.0.1' }).host, '100.64.0.1');
  assert.equal(developmentServer({ HOST: '127.0.0.1' }).host, 'localhost');
});

test('a loopback or wildcard bind proxies to the API on this machine', () => {
  for (const environment of [{}, { HOST: '0.0.0.0' }, { HOST: '127.0.0.1' }]) {
    const { proxy } = developmentServer({ ...environment, SERVER_PORT: '3001' });
    assert.equal(proxy['/api'], 'http://localhost:3001');
    assert.equal(proxy['/ws'].target, 'ws://localhost:3001');
    assert.equal(proxy['/ws'].ws, true);
  }
});

test('a named remote host proxies to the API on that same address', () => {
  // The tailnet dev setup binds both the API and Vite to the tailnet address;
  // the upstream follows the bind rather than silently crossing back to
  // loopback, where the server is not listening.
  const { proxy } = developmentServer({ HOST: '100.64.0.1', SERVER_PORT: '3001' });
  assert.equal(proxy['/api'], 'http://100.64.0.1:3001');
  assert.equal(proxy['/shell'].target, 'ws://100.64.0.1:3001');
});
