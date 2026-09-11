import { useEffect, useState } from 'react';

type UseDeviceSettingsOptions = { mobileBreakpoint?: number; trackMobile?: boolean; trackPWA?: boolean };

const browserAvailable = () => typeof window !== 'undefined';

function viewportIsMobile(breakpoint: number): boolean {
  return browserAvailable() && window.innerWidth < breakpoint;
}

function standaloneDisplay(): boolean {
  if (!browserAvailable()) return false;

  const browserNavigator = navigator as Navigator & { standalone?: boolean };
  return document.referrer.includes('android-app://')
    || browserNavigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

export function useDeviceSettings(options: UseDeviceSettingsOptions = {}) {
  const breakpoint = options.mobileBreakpoint ?? 768;
  const mobileEnabled = options.trackMobile ?? true;
  const pwaEnabled = options.trackPWA ?? true;
  const [isMobile, setIsMobile] = useState(() => mobileEnabled && viewportIsMobile(breakpoint));
  const [isPWA, setIsPWA] = useState(() => pwaEnabled && standaloneDisplay());

  useEffect(() => {
    if (!mobileEnabled || !browserAvailable()) return undefined;

    const refresh = () => setIsMobile(viewportIsMobile(breakpoint));
    refresh();
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, [breakpoint, mobileEnabled]);

  useEffect(() => {
    if (!pwaEnabled || !browserAvailable()) return undefined;

    const displayMode = window.matchMedia('(display-mode: standalone)');
    const refresh = () => setIsPWA(standaloneDisplay());
    refresh();

    if ('addEventListener' in displayMode && typeof displayMode.addEventListener === 'function') {
      displayMode.addEventListener('change', refresh);
      return () => displayMode.removeEventListener('change', refresh);
    }

    displayMode.addListener(refresh);
    return () => displayMode.removeListener(refresh);
  }, [pwaEnabled]);

  return { isMobile, isPWA };
}

/**
 * Detect whether the client is a mobile or touch-first device where focusing an
 * input summons the on-screen virtual keyboard.
 */
export function isTouchOrMobileDevice(): boolean {
  if (!browserAvailable()) return false;
  return (
    window.innerWidth < 768
    || (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
  );
}

/**
 * Safely handle focus for popup search inputs: on desktop, focus immediately so
 * the user can type to filter. On mobile or touch devices, skip autofocus so the
 * virtual keyboard does not push popups offscreen, and blur any currently focused
 * element (like the composer textarea) so the viewport stays clean.
 */
export function focusSearchInputSafely(input: HTMLInputElement | null): void {
  if (!input) return;
  if (isTouchOrMobileDevice()) {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  } else {
    window.requestAnimationFrame(() => input.focus());
  }
}
