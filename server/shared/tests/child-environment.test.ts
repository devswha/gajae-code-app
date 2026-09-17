import assert from 'node:assert/strict';
import test from 'node:test';

import { childEnvironment, SERVER_ONLY_ENVIRONMENT_NAMES } from '@/shared/child-environment.js';

/*
 * The server starts processes that the owner - and the agent - can read the
 * environment of: the GJC worker (which runs `bash`), the terminal PTY, git.
 * The keys that authenticate a caller to this server are not part of that
 * environment; a local process that learns one calls the API as the owner.
 */

test('the desktop key, the bootstrap nonce and API_KEY never reach a child', () => {
  const child = childEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/owner',
    GJC_DESKTOP_API_KEY: 'a'.repeat(64),
    GJC_DESKTOP_BOOTSTRAP_NONCE: 'b'.repeat(64),
    API_KEY: 'self-hosted-key',
  });
  assert.equal(child.GJC_DESKTOP_API_KEY, undefined);
  assert.equal(child.GJC_DESKTOP_BOOTSTRAP_NONCE, undefined);
  assert.equal(child.API_KEY, undefined);
  assert.equal(Object.hasOwn(child, 'GJC_DESKTOP_API_KEY'), false, 'deleted, not set to undefined');
});

test('everything the child actually needs is preserved', () => {
  const source = { PATH: '/usr/bin', HOME: '/home/owner', LANG: 'en_US.UTF-8', GJC_DESKTOP: '1', NODE_ENV: 'production' };
  assert.deepEqual(childEnvironment(source), source);
});

test('the source environment is not mutated', () => {
  const source = { GJC_DESKTOP_API_KEY: 'secret', PATH: '/usr/bin' };
  childEnvironment(source);
  assert.equal(source.GJC_DESKTOP_API_KEY, 'secret');
});

test('the stripped names are the credentials this server accepts', () => {
  assert.deepEqual([...SERVER_ONLY_ENVIRONMENT_NAMES].sort(), ['API_KEY', 'GJC_DESKTOP_API_KEY', 'GJC_DESKTOP_BOOTSTRAP_NONCE']);
});
