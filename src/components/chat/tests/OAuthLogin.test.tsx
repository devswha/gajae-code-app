import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  oauthFailureForCode,
  parseOAuthAttempt,
  parseOAuthProvider,
  safeOAuthAuthorizationUrl,
} from '../hooks/useOAuthLogin';
import { shouldDisplayOAuthAuthorizationLink } from '../OAuthLoginDialog';


test('OAuth authorization URLs allow only absolute HTTPS origins', () => {
  assert.equal(safeOAuthAuthorizationUrl('https://login.example.test/authorize'), 'https://login.example.test/authorize');
  assert.equal(safeOAuthAuthorizationUrl('http://login.example.test/authorize'), null);
  assert.equal(safeOAuthAuthorizationUrl('javascript:alert(1)'), null);
  assert.equal(safeOAuthAuthorizationUrl('/relative/callback'), null);
});

test('OAuth frame parsing accepts safe state and excludes unsafe authorization URLs', () => {
  assert.deepEqual(parseOAuthProvider({
    id: 'openai-codex',
    name: 'ChatGPT Plus/Pro',
    available: true,
    authenticated: false,
  }), {
    id: 'openai-codex',
    name: 'ChatGPT Plus/Pro',
    available: true,
    authenticated: false,
  });

  assert.deepEqual(parseOAuthAttempt({
    attemptId: 'oauth-attempt-1',
    providerId: 'openai-codex',
    phase: 'awaiting_input',
    authorizationUrl: 'javascript:alert(1)',
    instruction: 'Paste the redirect code.',
    valueKind: 'password',
    password: true,
  }), {
    attemptId: 'oauth-attempt-1',
    providerId: 'openai-codex',
    phase: 'awaiting_input',
    instruction: 'Paste the redirect code.',
    valueKind: 'password',
    password: true,
  });

  assert.equal(parseOAuthAttempt({
    attemptId: 'oauth-attempt-1',
    providerId: 'openai-codex',
    phase: 'unknown-phase',
  }), null);
});

test('provider sign-in link remains visible while manual input is requested', () => {
  const authorizationUrl = 'https://login.example.test/authorize';
  const baseAttempt = {
    attemptId: 'oauth-attempt-1',
    providerId: 'openai-codex',
    authorizationUrl,
  } as const;

  assert.equal(shouldDisplayOAuthAuthorizationLink({ ...baseAttempt, phase: 'awaiting_browser' }), true);
  assert.equal(shouldDisplayOAuthAuthorizationLink({ ...baseAttempt, phase: 'awaiting_input' }), true);
  assert.equal(shouldDisplayOAuthAuthorizationLink({ ...baseAttempt, phase: 'persisting' }), false);
  assert.equal(shouldDisplayOAuthAuthorizationLink({
    attemptId: baseAttempt.attemptId,
    providerId: baseAttempt.providerId,
    phase: 'awaiting_input',
  }), false);
});

test('OAuth failure messages distinguish disconnect and persisted-login refresh failure', () => {
  assert.match(oauthFailureForCode('oauth_disconnected').message, /Connection lost/);
  assert.match(oauthFailureForCode('oauth_model_refresh_failed').message, /Sign-in was saved/);
  assert.equal(oauthFailureForCode('raw-provider-error').code, 'oauth_failed');
});

test('OAuth terminal failures expose safe retry messages without raw provider errors', () => {
  for (const code of ['oauth_login_failed', 'oauth_timed_out', 'raw-provider-error']) {
    const failure = oauthFailureForCode(code);
    assert.equal(failure.code, 'oauth_failed');
    assert.match(failure.message, /Try again/);
    assert.doesNotMatch(failure.message, /raw-provider-error/);
  }
});
test('desktop enables exactly one HTTPS-scoped external opener', async () => {
  const [packageJsonText, capabilityText, tauriConfigText, rustMainText] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src-tauri/capabilities/default.json', 'utf8'),
    readFile('src-tauri/tauri.conf.json', 'utf8'),
    readFile('src-tauri/src/main.rs', 'utf8'),
  ]);
  const packageJson = JSON.parse(packageJsonText) as {
    dependencies: Record<string, string>;
  };
  const capability = JSON.parse(capabilityText) as { permissions: string[] };
  const tauriConfig = JSON.parse(tauriConfigText) as {
    plugins: { shell: { open: string } };
  };

  assert.equal(packageJson.dependencies['@tauri-apps/plugin-shell'], '2.3.0');
  assert.equal(capability.permissions.filter((permission) => permission === 'shell:default').length, 1);
  assert.equal(tauriConfig.plugins.shell.open, '^https://.+');
  assert.equal((rustMainText.match(/tauri_plugin_shell::init\(\)/g) ?? []).length, 1);
  assert.equal(rustMainText.includes('tauri_plugin_opener'), false);
});
