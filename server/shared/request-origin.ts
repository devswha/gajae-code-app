import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

import { isLoopbackHost } from '../../shared/networkHosts.js';

/**
 * Whether a browser origin is allowed to talk to this server.
 *
 * The server runs shell commands on behalf of its single implicit owner, and
 * binding to loopback does not keep other sites away from it: a page the user
 * visits can open `ws://127.0.0.1:3001/ws` or `fetch` the API, because neither
 * a WebSocket handshake nor a simple cross-origin request is blocked by the
 * same-origin policy. Without this check, any website the owner visits could
 * read every project and transcript and start a turn.
 *
 * The rules, and why each one is what it is:
 *
 * - **Host admission comes first and defaults closed for DNS names.** Only
 *   loopback names and literal IP addresses work without ALLOWED_HOSTS. Other
 *   DNS names must be listed even when Origin matches Host or is omitted;
 *   otherwise a rebinding page can nominate its own hostname as trusted.
 *   IP literals cannot be rebound through DNS. Reverse-proxy deployments must
 *   list their published names; `*` explicitly opts out of host admission.
 * - **No Origin header: allowed after Host admission.** Same-origin GETs,
 *   native callers and navigations can omit it. Checking Host first prevents
 *   a rebinding page's GET from evading host admission.
 * - **`null`: rejected.** That is the opaque origin a sandboxed iframe, a
 *   `file://` page or a `data:` document sends. Nothing legitimate here uses it.
 * - **Same hostname as the request's Host: allowed, on any port.** In
 *   development the browser talks to Vite on 5173 and Vite proxies to 3001,
 *   forwarding the original Origin - so the ports never match and comparing
 *   them would break every dev session. DNS names still have to pass the
 *   Host admission above; equality alone is not evidence of trust.
 * - **Loopback to loopback: allowed.** `localhost` and `127.0.0.1` are the same
 *   machine, and which one appears depends on how the user typed the URL.
 * - **One of this machine's own addresses: allowed.** Reaching the app over a
 *   LAN or tailnet address works today with no configuration, and in
 *   development Vite proxies to `localhost`, so the Host the server sees is not
 *   the address the browser used. An origin that is literally one of our own
 *   interfaces is us; a remote site's origin never is.
 * - **Listed in ALLOWED_HOSTS: allowed.** The same variable Vite already uses to
 *   admit a tailnet name or a reverse proxy's hostname, so exposing the app
 *   deliberately stays one decision in one place.
 */
export type OriginPolicy = {
  /** Value of the request's `Host` header. */
  hostHeader: string | undefined;
  /** Parsed `ALLOWED_HOSTS`: `true` allows any; absent means no extra DNS names. */
  allowedHosts: readonly string[] | true | undefined;
};

/** Host header without its port, tolerating IPv6 literals. */
function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || /[\\/?#@\s]/u.test(trimmed)) return undefined;
  try {
    return new URL(`http://${trimmed}`).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Addresses assigned to this machine's own interfaces.
 *
 * Read once: an interface appearing mid-process is not worth re-scanning for on
 * every request, and a restart picks it up.
 */
let ownAddresses: Set<string> | undefined;
function isOwnAddress(hostname: string): boolean {
  if (ownAddresses === undefined) {
    ownAddresses = new Set<string>();
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        // Node reports IPv6 link-local addresses with a zone suffix that a URL
        // hostname never carries.
        ownAddresses.add(entry.address.split('%')[0].toLowerCase());
      }
    }
  }
  return ownAddresses.has(hostname.replace(/^\[|\]$/g, ''));
}

function matchesAllowedHost(hostname: string, allowedHosts: readonly string[] | true | undefined): boolean {
  if (allowedHosts === true) return true;
  if (!allowedHosts) return false;
  return allowedHosts.some((entry) => {
    const candidate = entry.trim().toLowerCase();
    if (!candidate) return false;
    // Vite's "this domain and any subdomain" form, kept identical here so one
    // ALLOWED_HOSTS value means the same thing on both sides.
    if (candidate.startsWith('.')) {
      return hostname === candidate.slice(1) || hostname.endsWith(candidate);
    }
    return hostname === candidate;
  });
}

export function isAllowedRequestOrigin(
  origin: string | undefined,
  { hostHeader, allowedHosts }: OriginPolicy,
): boolean {
  const requestHostname = hostnameOf(hostHeader)?.toLowerCase();
  if (!requestHostname) return false;
  if (!isLoopbackHost(requestHostname)
      && !isIP(requestHostname.replace(/^\[|\]$/g, ''))
      && !matchesAllowedHost(requestHostname, allowedHosts)) {
    return false;
  }
  if (origin === undefined || origin === '') return true;
  if (origin === 'null') return false;

  let originHostname: string;
  try {
    originHostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!originHostname) return false;

  if (originHostname === requestHostname) return true;
  if (isLoopbackHost(originHostname) && isLoopbackHost(requestHostname)) return true;
  if (isOwnAddress(originHostname)) return true;

  return matchesAllowedHost(originHostname, allowedHosts);
}
