import { PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MainContentHeaderProps } from '../types/types';
import ToolOutputDensityToggle from '../../chat/view/ToolOutputDensityToggle';

import MobileMenuButton from './MobileMenuButton';
import MainContentTitle from './MainContentTitle';

export default function MainContentHeader({
  selectedProject,
  selectedSession,
  isMobile,
  onMenuClick,
  sidebarOpen,
  onToggleSidebar,
}: MainContentHeaderProps) {
  const { t } = useTranslation();

  return (
    // The bar spans the full row, but its title lines up with the conversation
    // below it, which the chat lane insets by `pl-2` to clear the sidebar rail.
    <div className="pwa-header-safe shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2 md:pl-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            selectedProject={selectedProject}
            selectedSession={selectedSession}
          />
        </div>

        {/* Chat is the only view, so there is no view switcher: a one-tab
            segmented control read as a mode the user could leave. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ToolOutputDensityToggle />
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? t('agentSidebar.close') : t('agentSidebar.open')}
            title={sidebarOpen ? t('agentSidebar.close') : t('agentSidebar.open')}
            className={`shrink-0 rounded-md p-1.5 transition-colors ${
              sidebarOpen
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
