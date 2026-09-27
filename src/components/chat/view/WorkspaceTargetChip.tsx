import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FolderGit2, Search } from 'lucide-react';

import { useAnchoredPopup } from '../../../hooks/useAnchoredPopup';
import { focusSearchInputSafely } from '../../../hooks/useDeviceSettings';
import { cn } from '../../../utils/cn';
import type { WorkspaceCandidate } from '../hooks/useWorkspaceTarget';

interface WorkspaceTargetChipProps {
  /** Display name of the workspace root project, shown when no target is picked. */
  workspaceRootName: string;
  candidates: WorkspaceCandidate[];
  target: WorkspaceCandidate | null;
  onPick: (candidate: WorkspaceCandidate | null) => void;
}

const POPUP_WIDTH = 320;
// Search row + 18rem list + keep-at-root row, the tallest the popup gets.
const POPUP_MAX_HEIGHT = 380;

/**
 * The workspace-quick-task chip: shown above the composer only for a new task
 * started in a workspace-root project (e.g. `~/Projects`). Reads either
 * "→ {child}" when a target is resolved or picked, or the workspace root name
 * with a "choose repo" affordance when none is. Clicking either opens a
 * searchable picker of every candidate repo plus "keep at root"; a workspace
 * root routinely has dozens of repos, so the list scrolls and filters like the
 * skill picker does.
 */
export default function WorkspaceTargetChip({ workspaceRootName, candidates, target, onPick }: WorkspaceTargetChipProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Opens upward so a long repo list never covers the composer; on the
  // empty-state screen, where the composer sits mid-viewport, it opens
  // downward instead of clipping at the top edge.
  const popupPosition = useAnchoredPopup({
    open,
    onClose: () => setOpen(false),
    anchorRef: rootRef,
    popupRef,
    width: POPUP_WIDTH,
    flipBelowUnder: POPUP_MAX_HEIGHT,
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    focusSearchInputSafely(searchRef.current);
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return candidates;
    return candidates.filter((candidate) => candidate.name.toLowerCase().includes(normalized));
  }, [candidates, query]);

  const pick = (candidate: WorkspaceCandidate | null) => {
    onPick(candidate);
    setOpen(false);
  };

  const label = target
    ? t('workspaceTarget.target', { name: target.name })
    : `${workspaceRootName} · ${t('workspaceTarget.chooseRepo')}`;

  return (
    <div ref={rootRef} className="mx-auto mb-1.5 max-w-chat">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={target ? label : t('workspaceTarget.chooseRepo')}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 text-xs transition-colors hover:bg-accent hover:text-foreground',
          target ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="max-w-64 truncate">{label}</span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-80 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ ...popupPosition, width: POPUP_WIDTH }}
        >
          <div className="relative px-1 pb-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && filtered.length > 0) {
                  event.preventDefault();
                  pick(filtered[0]);
                }
              }}
              placeholder={t('workspaceTarget.search')}
              aria-label={t('workspaceTarget.search')}
              className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-hidden placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
          <div role="listbox" aria-label={t('workspaceTarget.chooseRepo')} className="max-h-72 overflow-y-auto">
            {filtered.map((candidate) => (
              <button
                key={candidate.path}
                type="button"
                role="option"
                aria-selected={target?.path === candidate.path}
                onClick={() => pick(candidate)}
                className={cn(
                  'flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-accent',
                  target?.path === candidate.path && 'bg-accent/60',
                )}
              >
                <span className="truncate text-xs font-medium">{candidate.name}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">{t(`workspaceTarget.reason.${candidate.reason}`)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">{t('workspaceTarget.noMatch')}</p>
            )}
          </div>
          <div className="mt-1 border-t border-border/60 pt-1">
            <button
              type="button"
              role="option"
              aria-selected={target === null}
              onClick={() => pick(null)}
              className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t('workspaceTarget.keepAtRoot')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
