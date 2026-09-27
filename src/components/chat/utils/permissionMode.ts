import { ShieldHalf, ShieldOff, ShieldQuestion, type LucideIcon } from 'lucide-react';

import { PERMISSION_MODES, type PermissionMode } from '../../../hooks/useProjectPermissions';
import { modShortcutLabel } from '../../../utils/shortcutLabel';

export { PERMISSION_MODES };
export type { PermissionMode };

/** One glyph per mode; bypass is the open shield so it reads as the exception at a glance. */
export const PERMISSION_MODE_ICONS: Record<PermissionMode, LucideIcon> = {
  ask: ShieldQuestion,
  auto_edits: ShieldHalf,
  bypass: ShieldOff,
};

/** The chord as the keyboard in front of the user labels it. */
export const permissionModeShortcutLabel = (): string => modShortcutLabel('P', { shift: true });

/**
 * The composer shortcut: Cmd/Ctrl+Shift+P ("permissions"). It opens the
 * picker rather than cycling, because a chord that could land on bypass
 * without a confirmation is not a shortcut anyone asked for. Cmd/Ctrl+K is the
 * palette and Cmd/Ctrl+Shift+D the density toggle; this is the next free one.
 */
export const opensPermissionModePicker = (event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>): boolean =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && !event.repeat && event.key.toLowerCase() === 'p';
