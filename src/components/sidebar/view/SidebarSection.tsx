import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../../utils/cn';

type SidebarSectionProps = {
  readonly id: string;
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly children: ReactNode;
};

export default function SidebarSection({
  id,
  title,
  open,
  onOpenChange,
  actionLabel,
  onAction,
  children,
}: SidebarSectionProps) {
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="group/section flex h-9 items-center gap-1 px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-[0.8125rem] font-medium text-muted-foreground outline-hidden transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls={`${id}-content`}
        >
          <span id={`${id}-heading`} className="truncate">{title}</span>
          <ChevronRight
            className={cn('size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')}
            aria-hidden
          />
        </button>
        {onAction && actionLabel && (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 outline-hidden transition-all group-hover/section:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onAction}
            aria-label={actionLabel}
            title={actionLabel}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <div id={`${id}-content`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
