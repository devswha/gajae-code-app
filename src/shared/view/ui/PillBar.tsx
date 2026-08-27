import type { KeyboardEvent, ReactNode, Ref } from 'react';

import { cn } from '../../../utils/cn';

/* ── Container ─────────────────────────────────────────────────── */
type PillBarProps = {
  children: ReactNode;
  className?: string;
  // Set when the bar is an ARIA tablist rather than a plain group of buttons.
  role?: 'tablist';
  'aria-label'?: string;
};

export function PillBar({ children, className, role, 'aria-label': ariaLabel }: PillBarProps) {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-[2px] rounded-lg bg-muted/60 p-[3px]', className)}
    >
      {children}
    </div>
  );
}

/* ── Individual pill button ────────────────────────────────────── */
type PillProps = {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  id?: string;
  // A pill inside a tablist has to carry the tab semantics itself, otherwise
  // the strip is a row of unrelated buttons to assistive technology.
  role?: 'tab';
  ariaSelected?: boolean;
  ariaControls?: string;
  tabIndex?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function Pill({
  isActive,
  onClick,
  children,
  className,
  id,
  role,
  ariaSelected,
  ariaControls,
  tabIndex,
  onKeyDown,
  buttonRef,
}: PillProps) {
  return (
    <button
      type="button"
      ref={buttonRef}
      id={id}
      role={role}
      aria-selected={ariaSelected}
      aria-controls={ariaControls}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        'flex touch-manipulation items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground active:bg-background/50',
        className,
      )}
    >
      {children}
    </button>
  );
}
