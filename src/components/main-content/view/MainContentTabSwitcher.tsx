import { MessageSquare, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, PillBar, Pill } from '../../../shared/view/ui';
import type { AppTab } from '../../../types/app';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
};

type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

type TabDefinition = BuiltInTab;

// Shell/Git/Files tabs were removed on purpose: app-pty CLI spawning duplicated
// the external CLI terminal lane (and tied CLIs to the server lifecycle — one
// died on service restart), and a manual git UI clashes with the agent-driven
// branch-flow discipline. File browsing, the git panel and the embedded editor
// were retired with them; files now open in the user's own editor. Persisted
// 'shell'/'git'/'files' tabs are reset to 'chat' in MainContent.
const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
];

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs: TabDefinition[] = [...BASE_TABS];

  return (
    <PillBar>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = t(tab.labelKey);

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill
              isActive={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="px-2.5 py-[5px]"
            >
              <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="hidden lg:inline">{displayLabel}</span>
            </Pill>
          </Tooltip>
        );
      })}
    </PillBar>
  );
}
