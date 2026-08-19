import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  admitQaHost,
  isolatedQaEnvironment,
  isLoopbackHost,
  safeAgentConfigPaths,
} from './start-isolated-dev.mjs';

test('loopback hosts are admitted without remote exposure', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.deepEqual(admitQaHost('127.0.0.1'), { host: '127.0.0.1', remote: false });
});

test('only a current Tailscale IPv4 is admitted remotely', () => {
  assert.deepEqual(admitQaHost('100.78.133.28', ['100.78.133.28']), {
    host: '100.78.133.28',
    remote: true,
  });
  assert.throws(() => admitQaHost('192.168.1.10', ['100.78.133.28']), /Refusing non-loopback/);
  assert.throws(() => admitQaHost('203.0.113.8', []), /Refusing non-loopback/);
});

test('isolated environment redirects every persistent runtime root', () => {
  const env = isolatedQaEnvironment({
    parentEnv: { PATH: '/bin', HOME: '/Users/real', GAJAE_ALLOW_UNAUTH_REMOTE: '1' },
    qaHome: '/tmp/qa-one',
    host: '127.0.0.1',
    vitePort: 5174,
    serverPort: 3101,
    remote: false,
  });
  assert.equal(env.HOME, '/tmp/qa-one');
  assert.equal(env.USERPROFILE, '/tmp/qa-one');
  assert.equal(env.DATABASE_PATH, '/tmp/qa-one/.gajae-app/auth.db');
  assert.equal(env.GJC_CODING_AGENT_DIR, '/tmp/qa-one/.gjc/agent');
  assert.equal(env.GJC_WORKER_AGENT_DIR, '/tmp/qa-one/.gjc/agent');
  assert.equal(env.GJC_LIVE_SESSION_DIR, '/tmp/qa-one/.gjc/live-sessions');
  assert.equal(env.CARGO_HOME, '/Users/real/.cargo');
  assert.equal(env.RUSTUP_HOME, '/Users/real/.rustup');
  assert.equal(env.GAJAE_ALLOW_UNAUTH_REMOTE, undefined);
});

test('remote isolated environment enables only the admitted private override', () => {
  const env = isolatedQaEnvironment({
    parentEnv: {},
    qaHome: '/tmp/qa-two',
    host: '100.78.133.28',
    vitePort: '5174',
    serverPort: '3101',
    remote: true,
  });
  assert.equal(env.GAJAE_ALLOW_UNAUTH_REMOTE, '1');
});

test('only model configuration files are eligible for copying', () => {
  assert.deepEqual(safeAgentConfigPaths('/Users/real', '/tmp/qa').map(({ source, destination }) => ({
    source: path.basename(source),
    destination: path.basename(destination),
  })), [
    { source: 'config.yml', destination: 'config.yml' },
    { source: 'models.yml', destination: 'models.yml' },
  ]);
});
