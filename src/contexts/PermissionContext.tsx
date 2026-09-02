import { createContext, useContext } from 'react';

import type { PendingPermissionRequest, PermissionDecision } from '../components/chat/types/types';

export interface PermissionContextValue { pendingPermissionRequests: PendingPermissionRequest[]; handlePermissionDecision: (requestIds: string | string[], decision: PermissionDecision) => void; }

const PermissionContext = createContext<PermissionContextValue | null>(null);

export const usePermission = (): PermissionContextValue | null => useContext(PermissionContext);

export default PermissionContext;
