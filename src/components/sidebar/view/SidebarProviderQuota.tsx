import { QueryClientContext } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useContext } from 'react';

import { useProviderQuota } from '../../../hooks/useProviderQuota';
import { cn } from '../../../utils/cn';

import ProviderQuotaRing, { ProviderQuotaRingPlaceholder } from './ProviderQuotaRing';

type SidebarProviderQuotaProps = {
  collapsed?: boolean;
  t: TFunction;
};

/**
 * Ambient quota row shown directly above the Settings control.
 *
 * It stays secondary to the footer's real controls: no numbers in the compact
 * state, a fixed indicator height in every state, and nothing at all when no
 * connected provider has quota to report. Many providers scroll horizontally
 * rather than growing the footer.
 */
function ProviderQuotaRow({ collapsed, t }: Required<Pick<SidebarProviderQuotaProps, 'collapsed'>> & { t: TFunction }) {
  const { providers, isLoading, hasFailed } = useProviderQuota();

  if (providers.length === 0) {
    // Nothing connected, or the snapshot could not be read: render no section
    // at all rather than an empty one. The first fetch keeps a fixed-size
    // placeholder so the footer does not shift when the rings arrive.
    if (!isLoading || hasFailed) return null;
    return (
      <div className={cn('flex items-center', collapsed ? 'flex-col gap-1 py-0.5' : 'gap-1.5 px-2.5 py-1')} aria-hidden>
        <ProviderQuotaRingPlaceholder />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center',
        // The collapsed rail is 48px wide and already carries the primary
        // controls, so its strip is capped at roughly four indicators and
        // scrolls for the rest. Quota-bearing providers sort first, so the cap
        // hides the ones with nothing to read. Expanded, the row scrolls
        // sideways rather than growing the footer.
        collapsed
          ? 'max-h-28 [scrollbar-width:none] flex-col gap-1 overflow-y-auto py-0.5 [&::-webkit-scrollbar]:hidden'
          : '[scrollbar-width:none] gap-1.5 overflow-x-auto px-2.5 py-1 [&::-webkit-scrollbar]:hidden',
      )}
      aria-label={t('providerQuota.title')}
    >
      {providers.map((entry) => (
        <ProviderQuotaRing
          key={entry.provider}
          entry={entry}
          tooltipPosition={collapsed ? 'right' : 'top'}
          t={t}
        />
      ))}
    </div>
  );
}

export default function SidebarProviderQuota({ collapsed = false, t }: SidebarProviderQuotaProps) {
  const queryClient = useContext(QueryClientContext);

  // The footer is also rendered on its own (static markup, isolated component
  // tests). Without the app's server-state provider there is nothing to read,
  // so the row does not exist instead of throwing.
  if (!queryClient) return null;
  return <ProviderQuotaRow collapsed={collapsed} t={t} />;
}
