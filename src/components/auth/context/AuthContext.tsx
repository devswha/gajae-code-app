import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../../../utils/api';
import { markDesktopShell } from '../../../utils/externalLink';
import type { AuthContextValue, AuthProviderProps, AuthUser, AuthUserPayload } from '../types';

const AuthContext = createContext<AuthContextValue | null>(null);

// A single failed owner bootstrap used to mis-wire the whole session: the page
// still rendered, but the desktop shell never learned it was one, so every
// external link went to window.open and silently died in the webview. The
// sidecar answers late while it starts up and runs its initial session sync,
// so server trouble gets a bounded quiet retry. A 4xx is a real auth state
// (the browser login screen) and keeps the single-attempt behavior.
const BOOTSTRAP_RETRY_DELAY_MS = 3000;
const BOOTSTRAP_RETRY_LIMIT = 12;

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const bootstrapUser = async () => {
      try {
        const response = await api.auth.user({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status >= 500) {
          throw new Error(`Owner bootstrap is temporarily unavailable: ${response.status}`);
        }
        if (response.ok) {
          const payload = (await response.json()) as AuthUserPayload;
          if (!controller.signal.aborted) {
            markDesktopShell(payload.shell?.desktop === true);
            setUser(payload.user ?? null);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (attempts < BOOTSTRAP_RETRY_LIMIT) {
          attempts += 1;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void bootstrapUser();
          }, BOOTSTRAP_RETRY_DELAY_MS);
          return;
        }
        console.error('[Auth] Owner bootstrap failed:', error);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void bootstrapUser();
    return () => {
      controller.abort();
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, []);

  const contextValue = useMemo<AuthContextValue>(() => ({ user, isLoading }), [isLoading, user]);

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
