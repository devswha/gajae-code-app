import { Ban, Check, Loader2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../../../utils/cn';

export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

type StatusPresentation = { label: string; className: string; Icon: LucideIcon };

const statusPresentation: Record<ToolStatus, StatusPresentation> = {
  running: { label: 'Running', className: 'text-muted-foreground', Icon: Loader2 },
  completed: { label: 'Completed', className: 'text-muted-foreground', Icon: Check },
  error: { label: 'Error', className: 'text-destructive', Icon: X },
  denied: { label: 'Denied', className: 'text-muted-foreground', Icon: Ban },
};

interface ToolStatusBadgeProps { status: ToolStatus; className?: string }

export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const presentation = statusPresentation[status];
  const StatusIcon = presentation.Icon;
  const spinning = status === 'running';

  return (
    <span className={cn('inline-flex shrink-0 items-center', presentation.className, className)}>
      <StatusIcon className={cn('size-3.5', spinning && 'animate-spin')} aria-hidden="true" />
      <span className="sr-only">{presentation.label}</span>
    </span>
  );
}
