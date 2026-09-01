const copyWithSelection = (value: string): boolean => {
  if (!value || typeof document === 'undefined') return false;

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(field);
  field.focus();
  field.select();

  try {
    return document.execCommand('copy');
  } catch {
    // Older document implementations can reject the legacy command.
    return false;
  } finally {
    document.body.removeChild(field);
  }
};

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // A denied asynchronous clipboard request falls through to selection copy.
  }

  return copyWithSelection(text);
}