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

test('a state mismatch tells the person to use the newest link', () => {
  const failure = oauthFailureForCode('oauth_state_mismatch');
  assert.equal(failure.code, 'oauth_state_mismatch');
  assert.match(failure.message, /earlier sign-in attempt/);
  assert.match(failure.message, /link shown now/);
});

test('OAuth terminal failures expose safe retry messages without raw provider errors', () => {
  for (const code of ['oauth_login_failed', 'oauth_timed_out', 'raw-provider-error']) {
    const failure = oauthFailureForCode(code);
    assert.equal(failure.code, 'oauth_failed');
    assert.match(failure.message, /Try again/);
    assert.doesNotMatch(failure.message, /raw-provider-error/);
  }
});
test('the sign-in link leaves the app through the sidecar in the desktop shell, not through Tauri IPC', async () => {
  const [packageJsonText, rustMainText, systemRoutesText] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src-tauri/src/main.rs', 'utf8'),
    readFile('server/routes/system.js', 'utf8'),
  ]);
  const packageJson = JSON.parse(packageJsonText) as { dependencies: Record<string, string> };

  // The webview loads the server's loopback origin, where Tauri IPC is not
  // injected (src-tauri/src/main.rs says so), so a client-side plugin could
  // never open anything there; the sidecar's open-url route does.
  assert.equal('@tauri-apps/plugin-shell' in packageJson.dependencies, false);
  assert.match(rustMainText, /Tauri IPC event\s+\/\/ injection is not guaranteed/);
  assert.match(systemRoutesText, /router\.post\('\/open-url'/);
});
