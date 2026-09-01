import { Bell, GitBranch, Info, Mic, MonitorCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../utils/cn';
import type { SettingsMainTab } from '../types/types';

type SettingsMainTabsProps = { activeTab: SettingsMainTab; onChange: (tab: SettingsMainTab) => void };
type MainTabConfig = readonly [SettingsMainTab, string, typeof GitBranch | undefined];

const TAB_CONFIG: MainTabConfig[] = [
  ['appearance', 'mainTabs.appearance', undefined],
  ['git', 'mainTabs.git', GitBranch],
  ['voice', 'mainTabs.voice', Mic],
  ['notifications', 'mainTabs.notifications', Bell],
  ['automation', 'mainTabs.automation', MonitorCog],
  ['about', 'mainTabs.about', Info],
];

export default function SettingsMainTabs({ activeTab, onChange }: SettingsMainTabsProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="border-b border-border">
      <div className="scrollbar-hide flex overflow-x-auto px-4 md:px-6" role="tablist" aria-label={t('mainTabs.label', { defaultValue: 'Settings' })}>
        {TAB_CONFIG.map(([id, labelKey, Icon]) => <button
          key={id}
          role="tab"
          aria-selected={activeTab === id}
          onClick={() => onChange(id)}
          className={cn(
            'border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
            activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {Icon ? <Icon className="mr-2 inline h-4 w-4" /> : null}
          {t(labelKey)}
        </button>)}
      </div>
    </div>
  );
}
