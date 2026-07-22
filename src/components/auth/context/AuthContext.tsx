import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../../../utils/api';
import type { AuthContextValue, AuthProviderProps, AuthUser, AuthUserPayload } from '../types';

const AuthContext = createContext<AuthContextValue | null>(null);

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

    const bootstrapUser = async () => {
      try {
        const response = await api.auth.user({ signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;

        const payload = (await response.json()) as AuthUserPayload;
        if (!controller.signal.aborted) {
          setUser(payload.user ?? null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[Auth] Owner bootstrap failed:', error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void bootstrapUser();
    return () => controller.abort();
  }, []);

  const contextValue = useMemo<AuthContextValue>(() => ({ user, isLoading }), [isLoading, user]);

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
