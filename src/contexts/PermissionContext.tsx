import { createContext, useContext } from 'react';

import type { PendingPermissionRequest } from '../components/chat/types/types';

export interface PermissionContextValue { pendingPermissionRequests: PendingPermissionRequest[]; handlePermissionDecision: (requestIds: string | string[], decision: { allow?: boolean; message?: string; updatedInput?: unknown }) => void; }

const PermissionContext = createContext<PermissionContextValue | null>(null);

export const usePermission = (): PermissionContextValue | null => useContext(PermissionContext);

export default PermissionContext;
