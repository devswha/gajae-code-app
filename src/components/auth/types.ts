import type { ReactNode } from 'react';

export type AuthUser = { id?: number | string; username: string; [key: string]: unknown };
export type AuthUserPayload = { user?: AuthUser; shell?: { desktop?: boolean } };
export type AuthContextValue = { user: AuthUser | null; isLoading: boolean };
export type AuthProviderProps = { children: ReactNode };
