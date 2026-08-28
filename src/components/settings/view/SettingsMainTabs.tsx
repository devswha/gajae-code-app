import { Bell, GitBranch, Info, Mic, MonitorCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SettingsMainTab } from '../types/types';

type SettingsMainTabsProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type MainTabConfig = {
  id: SettingsMainTab;
  labelKey?: string;
  label?: string;
  icon?: typeof GitBranch;
};

const TAB_CONFIG: MainTabConfig[] = [
  { id: 'appearance', labelKey: 'mainTabs.appearance' },
  { id: 'git', labelKey: 'mainTabs.git', icon: GitBranch },
  { id: 'voice', labelKey: 'mainTabs.voice', icon: Mic },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'automation', labelKey: 'mainTabs.automation', icon: MonitorCog },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

export default function SettingsMainTabs({ activeTab, onChange }: SettingsMainTabsProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="border-b border-border">
       <div className="scrollbar-hide flex overflow-x-auto px-4 md:px-6" role="tablist" aria-label={t('mainTabs.label', { defaultValue: 'Settings' })}>
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {Icon && <Icon className="mr-2 inline h-4 w-4" />}
              {tab.labelKey ? t(tab.labelKey) : tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
