/**
 * `crypto.randomUUID` is only exposed in secure contexts (HTTPS, localhost,
 * Tauri custom protocols). Plain-HTTP self-host origins still expose
 * `getRandomValues`, so fall back to assembling an RFC 4122 v4 string from
 * random bytes there.
 */
export function randomUUID(source: Crypto = globalThis.crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
