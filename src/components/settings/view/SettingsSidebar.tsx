import { Bell, GitBranch, Info, Mic, MonitorCog, Palette, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../utils/cn';
import { PillBar, Pill } from '../../../shared/view/ui';
import type { SettingsMainTab } from '../types/types';

type SettingsSidebarProps = { activeTab: SettingsMainTab; onChange: (tab: SettingsMainTab) => void };
type NavItem = readonly [SettingsMainTab, string, typeof Bell];

const NAV_ITEMS: NavItem[] = [
  ['appearance', 'mainTabs.appearance', Palette],
  ['permissions', 'mainTabs.permissions', ShieldCheck],
  ['git', 'mainTabs.git', GitBranch],
  ['voice', 'mainTabs.voice', Mic],
  ['notifications', 'mainTabs.notifications', Bell],
  ['automation', 'mainTabs.automation', MonitorCog],
  ['about', 'mainTabs.about', Info],
];

export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');
  const navigation = NAV_ITEMS.map(([id, labelKey, Icon]) => {
    const selected = id === activeTab;

    return { Icon, id, label: t(labelKey), selected };
  });

  return <><aside className="hidden w-56 shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
    <nav className="flex flex-col gap-1 p-3">
      {navigation.map(({ Icon, id, label, selected }) => <button
        key={id}
        onClick={() => onChange(id)}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150',
          selected ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground active:bg-accent/50',
        )}
      ><Icon className="h-4 w-4 shrink-0" />{label}</button>)}
    </nav>
  </aside>
  <div className="shrink-0 border-b border-border px-3 py-2 md:hidden">
    <PillBar className="scrollbar-hide w-full overflow-x-auto">
      {navigation.map(({ Icon, id, label, selected }) => <Pill key={id} isActive={selected} onClick={() => onChange(id)} className="shrink-0"><Icon className="h-3.5 w-3.5" />{label}</Pill>)}
    </PillBar>
  </div></>;
}
