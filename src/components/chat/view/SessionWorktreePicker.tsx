import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAnchoredPopup } from '../../../hooks/useAnchoredPopup';
import { cn } from '../../../utils/cn';
import type { SessionLocation } from '../hooks/useSessionLocation';

type Props = {
  value: boolean;
  onChange: (enabled: boolean) => void;
  sessionId?: string | null;
  location?: SessionLocation;
  disabled?: boolean;
};

const POPUP_WIDTH = 224;
const OPTIONS = [
  { worktree: false, labelKey: 'sessionWorktree.project' },
  { worktree: true, labelKey: 'sessionWorktree.newWorktree' },
] as const;

/**
 * Select once, before session creation; existing sessions retain their
 * location. The choice is a composer control like its neighbours - a ghost
 * trigger and a small listbox - not a bordered native select, which was the
 * one control in the toolbar drawn by the platform.
 */
export default function SessionWorktreePicker({ value, onChange, sessionId, location, disabled }: Props) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPopup({ open, onClose: () => setOpen(false), anchorRef: rootRef, popupRef, width: POPUP_WIDTH });

  if (sessionId) {
    if (location?.mode !== 'worktree') return null;
    // A fact about the running session, drawn as a tag so it does not read as
    // a control: the location is fixed once the session exists.
    return (
      <span className="inline-flex h-6 max-w-52 items-center gap-1.5 rounded-full bg-muted/60 px-2 text-xs text-muted-foreground" title={location.cwd ?? t('sessionWorktree.preparing')}>
        <GitBranch className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{location.cwd ? t('sessionWorktree.worktree') : t('sessionWorktree.preparing')}</span>
      </span>
    );
  }

  const current = t(value ? 'sessionWorktree.newWorktree' : 'sessionWorktree.project');
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        disabled={disabled}
        aria-label={t('sessionWorktree.label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('sessionWorktree.label')}
        className="flex min-h-11 max-w-52 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 sm:min-h-8"
      >
        <GitBranch className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{current}</span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          role="listbox"
          aria-label={t('sessionWorktree.label')}
          className="fixed z-80 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ ...position, width: POPUP_WIDTH }}
        >
          {OPTIONS.map((option) => {
            const selected = option.worktree === value;
            return (
              <button
                key={option.labelKey}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onChange(option.worktree);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs outline-hidden transition-colors hover:bg-accent focus-visible:bg-accent',
                  selected && 'bg-accent/70',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{t(option.labelKey)}</span>
                {selected && <Check className="size-3.5 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
