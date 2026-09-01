import type { ReactNode } from 'react';

import { useAuth } from '../context/AuthContext';

import AuthLoadingScreen from './AuthLoadingScreen';

type ProtectedRouteProps = { children: ReactNode };

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const authentication = useAuth();
  return authentication.isLoading ? <AuthLoadingScreen /> : <>{children}</>;
}
