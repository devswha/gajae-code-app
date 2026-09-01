const WILDCARD_ADDRESSES = new Set(['0.0.0.0', '::']);
const LOCAL_ADDRESSES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isWildcardHost(host) {
  return WILDCARD_ADDRESSES.has(host);
}

export function isLoopbackHost(host) {
  return LOCAL_ADDRESSES.has(host);
}

export function normalizeLoopbackHost(host) {
  return host && isLoopbackHost(host) ? 'localhost' : host;
}

export function getConnectableHost(host) {
  return !host || isWildcardHost(host) || isLoopbackHost(host) ? 'localhost' : host;
}

function splitHostList(rawValue) {
  return rawValue.split(',').reduce((hosts, part) => {
    const host = part.trim();
    if (host) hosts.push(host);
    return hosts;
  }, []);
}

export function parseAllowedHosts(value) {
  if (!value) return undefined;

  const hosts = splitHostList(value);
  if (hosts.includes('*')) return true;
  return hosts.length === 0 ? undefined : hosts;
}
