import { ChevronRight, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../shared/view/ui/Collapsible';
import { cn } from '../../../utils/cn';
import type { EgoActivityPage, EgoActivitySpace } from '../hooks/useEgoActivity';

/** Keep the lane compact; the rest is counted, never listed. */
const MAX_BROWSER_ROWS = 2;

/**
 * The page the browser is on: ego marks exactly one tab active per space, and
 * a space that has just been created has none yet.
 */
const currentPage = (space: EgoActivitySpace): EgoActivityPage | undefined =>
  space.pages.find((page) => page.active) ?? space.pages[0];

/**
 * What the agent's ego lite browser is doing, inside the WORK lane.
 *
 * The collapsed row answers the lane's question - which Space, and the page it
 * is on - and expands to the Space's other pages, because a browser job that
 * opened three tabs is exactly when one line stops being enough. Both levels
 * render only what ego reported: no action verbs, no elapsed time, no progress
 * claims, and no page the agent did not open.
 */
export default function AgentSidebarBrowser({ spaces }: { spaces: readonly EgoActivitySpace[] }) {
  const { t } = useTranslation();
  if (spaces.length === 0) return null;

  return (
    <div>
      <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70">{t('agentSidebar.work.browser')}</p>
      <ul>
        {spaces.slice(0, MAX_BROWSER_ROWS).map((space) => {
          const page = currentPage(space);
          const goal = space.name || t('agentSidebar.work.browserSpace', { id: space.id });
          return (
            <li key={space.id}>
              <Collapsible>
                <CollapsibleTrigger
                  className="group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/50 disabled:hover:bg-transparent"
                  disabled={space.pages.length === 0}
                  title={`${goal}${page?.url ? ` — ${page.url}` : ''}`}
                >
                  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">{t('agentSidebar.work.browserRunning')}: </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{goal}</span>
                    {page?.url ? <span className="block truncate text-muted-foreground">{page.url}</span> : null}
                  </span>
                  {space.pages.length > 0 && (
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" aria-hidden />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="pb-1 pl-7">
                    {space.pages.map((item) => (
                      <li
                        key={item.label}
                        className="py-0.5"
                        {...(item.active ? { 'aria-current': 'true' as const } : {})}
                        title={item.title ? `${item.title} — ${item.url}` : item.url}
                      >
                        {item.active ? <span className="sr-only">{t('agentSidebar.work.browserActivePage')}: </span> : null}
                        <span className={cn('block truncate', item.active ? 'text-foreground' : 'text-muted-foreground')}>
                          {item.title || item.url}
                        </span>
                        {item.title && item.url ? <span className="block truncate text-muted-foreground/70">{item.url}</span> : null}
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
        {spaces.length > MAX_BROWSER_ROWS && (
          <li className="px-2 py-1 pl-7 text-muted-foreground">
            {t('agentSidebar.work.browserMore', { count: spaces.length - MAX_BROWSER_ROWS })}
          </li>
        )}
      </ul>
    </div>
  );
}
