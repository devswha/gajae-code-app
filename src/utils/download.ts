/**
 * Saves a response body the browser cannot reach through a plain link.
 *
 * Authenticated downloads have to be fetched with the auth header and handed to
 * the browser as a blob, so the anchor is created, clicked and discarded here
 * rather than rendered.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick cancels the download in some browsers; the click
  // has been handled by the time the next task runs.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Reads the name the server chose for the file. `filename*` wins when present:
 * it is the percent-encoded UTF-8 form, so it survives non-ASCII titles that
 * the plain `filename` parameter cannot carry.
 */
export function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded[1].trim());
      if (decoded) return decoded;
    } catch {
      // A malformed value is not worth failing the download over.
    }
  }

  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  const name = plain?.[1]?.trim();
  return name || fallback;
}
