export function normalizeAutomationUrl(raw: string): string {
  const candidate = raw.trim();
  if (!candidate) return 'about:blank';
  if (candidate === 'about:blank') return candidate;
  // `localhost:5173` is a host/port shorthand, not a URL scheme. Treat only
  // non-numeric suffixes (javascript:, file:, mailto:, …) as explicit schemes.
  const isHostPort = /^[^/?#:\s]+:\d+(?:[/?#]|$)/u.test(candidate);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(candidate) && !isHostPort;
  const withScheme = hasScheme ? candidate : `http://${candidate}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('invalid_url: Only HTTP and HTTPS pages are supported.');
  }
  return parsed.href;
}

export function automationOrigin(raw: string): string | null {
  const normalized = normalizeAutomationUrl(raw);
  return normalized === 'about:blank' ? null : new URL(normalized).origin;
}
