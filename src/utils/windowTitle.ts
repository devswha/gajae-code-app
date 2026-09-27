import { BRAND_NAME } from '../constants/branding';

/**
 * The document title, which is also the desktop window's title and the
 * source of its Dock badge: the macOS shell reads a leading `(n) ` as the
 * number of conversations that need the user (`src-tauri/src/window_title.rs`).
 * A browser tab shows the same count, the convention of a mail tab.
 */
export function composeWindowTitle({ attention, place }: { attention: number; place?: string | null }): string {
  const count = Number.isSafeInteger(attention) && attention > 0 ? `(${attention}) ` : '';
  const where = place?.trim();
  return `${count}${where ? `${where} — ` : ''}${BRAND_NAME}`;
}
