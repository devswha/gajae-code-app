import type { ComponentType } from 'react';
import { Bell, GitBranch, Info, Mic, Palette } from 'lucide-react';

import type { SettingsMainTab } from '../types/types';

export type SettingsMainTabMeta = { id: SettingsMainTab; label: string; keywords: string; icon: ComponentType<{ className?: string }> };

const makeTab = (
  id: SettingsMainTab,
  label: string,
  keywords: string,
  icon: SettingsMainTabMeta['icon'],
): SettingsMainTabMeta => ({ id, label, keywords, icon });

export const SETTINGS_MAIN_TABS = [
  makeTab('appearance', 'Appearance', 'appearance theme dark light language', Palette),
  makeTab('git', 'Git', 'git github commits', GitBranch),
  makeTab('voice', 'Voice', 'voice speech audio', Mic),
  makeTab('notifications', 'Notifications', 'notifications alerts push', Bell),
  makeTab('about', 'About', 'about version info', Info),
];

