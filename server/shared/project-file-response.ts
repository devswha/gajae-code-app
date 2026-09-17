/**
 * Response headers for raw workspace bytes.
 *
 * A file in a project is content the app did not write: a cloned repository,
 * something the agent produced, an attachment. Served inline with its looked-up
 * type on the app's own origin, an HTML or SVG file is a script running as the
 * app, holding the app's cookie and able to call the whole loopback API.
 *
 * So only the raster images the chat renders stay inline. SVG is deliberately
 * not among them - it is a scriptable document. Everything else is an
 * `application/octet-stream` download, `nosniff` keeps the browser from
 * guessing its way back to HTML, and the sandbox CSP neutralizes whatever a
 * browser still decides to render.
 */
const INLINE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function isInlineProjectFileMimeType(mimeType: string | false | null | undefined): boolean {
  return typeof mimeType === 'string' && INLINE_MIME_TYPES.has(mimeType);
}

export function projectFileResponseHeaders(mimeType: string | false | null | undefined): Record<string, string> {
  const inline = isInlineProjectFileMimeType(mimeType);
  return {
    'Content-Type': inline ? (mimeType as string) : 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
  };
}
