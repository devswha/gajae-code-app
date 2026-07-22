import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateExposure } from './exposure-guard.js';

test('loopback binds are always allowed', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
        const result = evaluateExposure({ host });
        assert.equal(result.level, 'ok', host);
        assert.equal(result.reason, 'loopback');
    }
});

test('non-loopback binds are blocked by default', () => {
    for (const host of ['0.0.0.0', '::', '192.168.0.10', '100.123.228.51']) {
        const result = evaluateExposure({ host });
        assert.equal(result.level, 'block', host);
        assert.equal(result.reason, 'unauthenticated-remote');
        assert.match(result.message, /Refusing to listen/);
        assert.match(result.message, /GAJAE_ALLOW_UNAUTH_REMOTE=1/);
    }
});

test('GAJAE_ALLOW_UNAUTH_REMOTE=1 downgrades a remote bind to a loud warning', () => {
    const result = evaluateExposure({ host: '100.123.228.51', allowUnauthRemote: true });
    assert.equal(result.level, 'warn');
    assert.equal(result.reason, 'unauthenticated-remote-override');
    assert.match(result.message, /NO authentication/);
});

test('remote bind messages identify wildcard and specific addresses', () => {
    const wildcard = evaluateExposure({ host: '0.0.0.0' });
    assert.match(wildcard.message, /ALL network interfaces/);
    const specific = evaluateExposure({ host: '192.168.0.10' });
    assert.match(specific.message, /network address 192\.168\.0\.10/);
});
