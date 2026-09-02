import type { InterfaceFontSize } from '../../../utils/interfaceFontSize';

export type { InterfaceFontSize };

export type SettingsMainTab = 'appearance' | 'git' | 'voice' | 'notifications' | 'automation' | 'about';
export type ProjectSortOrder = 'name' | 'date';
export type NotificationPreferencesState = { channels: { inApp: boolean; desktop: boolean; sound: boolean }; events: { actionRequired: boolean; stop: boolean; error: boolean } };
export type SettingsProps = { isOpen: boolean; onClose: () => void; initialTab?: string };
