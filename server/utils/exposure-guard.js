// Fail-closed desktop exposure policy.
//
// This UI can run shell commands as the server user. It is intended to be
// reached through the desktop sidecar on loopback, so a network-reachable bind
// is blocked unless explicitly acknowledged for a trusted private network.
import { isLoopbackHost, isWildcardHost } from '../../shared/networkHosts.js';

/**
 * Decide whether the server may listen on `host`.
 *
 * Pure function — no process/env access — so the policy is unit-testable.
 *
 * @param {object} input
 * @param {string} input.host bind address (e.g. '127.0.0.1', '0.0.0.0')
 * @param {boolean} [input.allowUnauthRemote] explicit GAJAE_ALLOW_UNAUTH_REMOTE=1 opt-in
 * @returns {{level: 'ok'|'warn'|'block', reason: string, message?: string}}
 */
export function evaluateExposure({ host, allowUnauthRemote = false }) {
    const scope = isWildcardHost(host)
        ? 'ALL network interfaces'
        : `network address ${host}`;

    if (isLoopbackHost(host)) {
        return { level: 'ok', reason: 'loopback' };
    }

    if (!allowUnauthRemote) {
        return {
            level: 'block',
            reason: 'unauthenticated-remote',
            message:
                `Refusing to listen on ${scope}: anyone who can reach this port can run ` +
                'commands as this user.\n' +
                'Fix: keep the default loopback bind (leave HOST unset).\n' +
                'Override for a trusted private network (VPN/tailnet) only: ' +
                'GAJAE_ALLOW_UNAUTH_REMOTE=1.',
        };
    }

    return {
        level: 'warn',
        reason: 'unauthenticated-remote-override',
        message:
            `GAJAE_ALLOW_UNAUTH_REMOTE=1 — listening on ${scope} with NO authentication. ` +
            'Anyone who can reach this port can run commands as this user; make sure the ' +
            'address is only reachable through your private network.',
    };
}
