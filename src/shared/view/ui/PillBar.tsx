import type { KeyboardEvent, ReactNode, Ref } from 'react';

import { cn } from '../../../utils/cn';

type PillBarProps = { children: ReactNode; className?: string; role?: 'tablist'; 'aria-label'?: string };

export function PillBar({ 'aria-label': label, children, className, role }: PillBarProps) {
  return (
    <div
      role={role}
      aria-label={label}
      className={cn('inline-flex items-center gap-[2px] rounded-lg bg-muted/60 p-[3px]', className)}
    >
      {children}
    </div>
  );
}

type PillProps = { isActive: boolean; onClick: () => void; children: ReactNode; className?: string; id?: string; role?: 'tab'; ariaSelected?: boolean; ariaControls?: string; tabIndex?: number; onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void; buttonRef?: Ref<HTMLButtonElement> };

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
  const appearance = isActive
    ? 'bg-background text-foreground shadow-xs'
    : 'text-muted-foreground active:bg-background/50';

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
        appearance,
        className,
      )}
    >
      {children}
    </button>
  );
}
