/** Reveal an existing request without answering it or opening the mobile keyboard. */
export function focusPermissionRequest(requestIds: readonly string[]): boolean {
  const targets = document.querySelectorAll<HTMLElement>('[data-permission-request-id]');
  for (const requestId of requestIds) {
    // Compare values instead of interpolating an untrusted id into a CSS selector.
    const target = Array.from(targets).find((element) => element.dataset.permissionRequestId === requestId);
    if (!target) continue;
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    target.focus({ preventScroll: true });
    return true;
  }
  // A request may have been answered or cancelled since the sidebar rendered.
  return false;
}
