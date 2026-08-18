import { PanelLeftClose, Search } from 'lucide-react';
import type { TFunction } from 'i18next';

import { BRAND_NAME } from '../../../../constants/branding';
import { Button } from '../../../../shared/view/ui';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  onSearch: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  onSearch,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const searchLabel = t('actions.search', 'Search');

  return (
    <header
      className="flex flex-shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4 md:px-4 md:pb-3 md:pt-5"
      style={isPWA && isMobile ? { paddingTop: '16px' } : undefined}
    >
      {/*
        The sidebar is a fixed 288px (md:w-72), and the two utility buttons plus
        padding leave the wordmark roughly its own rendered width — so anything
        else on this row pushes it into an ellipsis. `truncate` stays as the
        graceful fallback for longer localized names and narrow viewports, with
        `title` keeping the full name recoverable when it does clip.
      */}
      <div className="flex min-w-0 items-center gap-1.5">
        <img src="/mark.svg" alt="" className="size-6 flex-shrink-0 object-contain" />
        <h1
          className="truncate text-[1.125rem] font-semibold tracking-[-0.02em] text-foreground"
          title={BRAND_NAME}
        >
          {BRAND_NAME}
        </h1>
      </div>

      <div className="flex flex-shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="size-8 rounded-lg p-0 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
          onClick={onSearch}
          aria-label={searchLabel}
          title={`${searchLabel} (Ctrl+K)`}
        >
          <Search className="size-[1.125rem]" />
        </Button>
        {!isMobile && (
          <Button
            variant="ghost"
            size="sm"
            className="size-8 rounded-lg p-0 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
            onClick={onCollapseSidebar}
            aria-label={t('tooltips.hideSidebar')}
            title={t('tooltips.hideSidebar')}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
