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
