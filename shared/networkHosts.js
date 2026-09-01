const WILDCARD_ADDRESSES = new Set(['0.0.0.0', '::']);
const LOCAL_ADDRESSES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const isWildcardHost = (host) => WILDCARD_ADDRESSES.has(host);

export const isLoopbackHost = (host) => LOCAL_ADDRESSES.has(host);

export const normalizeLoopbackHost = (host) => (host && isLoopbackHost(host) ? 'localhost' : host);

export const getConnectableHost = (host) => (
  !host || isWildcardHost(host) || isLoopbackHost(host) ? 'localhost' : host
);

function splitHostList(rawValue) {
  const hosts = [];
  for (const value of rawValue.split(',')) {
    const host = value.trim();
    if (host) hosts.push(host);
  }
  return hosts;
}

export function parseAllowedHosts(value) {
  if (!value) return undefined;

  const hosts = splitHostList(value);
  if (hosts.includes('*')) return true;
  return hosts.length ? hosts : undefined;
}
