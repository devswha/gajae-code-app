import type { ComponentType } from 'react';

import type { PendingPermissionRequest } from '../../types/types';

export interface PermissionPanelProps {
  request: PendingPermissionRequest;
  onDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; updatedInput?: unknown },
  ) => void;
}

const permissionPanelStore = () => {
  const panels: Record<string, ComponentType<PermissionPanelProps>> = {};
  return {
    add: (name: string, panel: ComponentType<PermissionPanelProps>) => {
      panels[name] = panel;
    },
    find: (name: string) => panels[name] || null,
  };
};

const permissionPanels = permissionPanelStore();

export function registerPermissionPanel(
  toolName: string,
  component: ComponentType<PermissionPanelProps>,
): void {
  permissionPanels.add(toolName, component);
}

export function getPermissionPanel(
  toolName: string,
): ComponentType<PermissionPanelProps> | null {
  return permissionPanels.find(toolName);
}
