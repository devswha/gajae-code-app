export function isWildcardHost(host) {
  return host === '0.0.0.0' || host === '::';
}

export function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function normalizeLoopbackHost(host) {
  if (!host) {
    return host;
  }
  return isLoopbackHost(host) ? 'localhost' : host;
}

// Use localhost for connectable loopback and wildcard addresses in browser-facing URLs.
export function getConnectableHost(host) {
  if (!host) {
    return 'localhost';
  }
  return isWildcardHost(host) || isLoopbackHost(host) ? 'localhost' : host;
}

/**
 * Parse a comma-separated ALLOWED_HOSTS value into Vite's `server.allowedHosts`.
 *
 * Vite rejects requests whose Host header is not an IP or `localhost`. That is
 * DNS-rebinding protection: without it, any website your browser visits could
 * point a hostname at this machine and drive the dev server. Reaching the dev
 * server by a private DNS name — a tailnet MagicDNS name, or a reverse proxy's
 * hostname — therefore requires listing that name.
 *
 * A leading dot is Vite's "this domain and any subdomain" form, so
 * `.tail1e211e.ts.net` covers every node in one tailnet.
 *
 * `*` maps to Vite's allow-all. That removes the rebinding check entirely and
 * is only appropriate on a network already trusted to reach the port at all.
 *
 * @param {string | undefined} value raw env value
 * @returns {string[] | true | undefined} undefined keeps Vite's default
 */
export function parseAllowedHosts(value) {
  if (!value) {
    return undefined;
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.includes('*')) {
    return true;
  }
  return entries.length > 0 ? entries : undefined;
}
