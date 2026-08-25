import { Ban, Check, Loader2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

const STATUS_CONFIG: Record<ToolStatus, { label: string; className: string; Icon: LucideIcon }> = {
  running: {
    label: 'Running',
    className: 'text-muted-foreground',
    Icon: Loader2,
  },
  completed: {
    label: 'Completed',
    className: 'text-muted-foreground',
    Icon: Check,
  },
  error: {
    label: 'Error',
    className: 'text-destructive',
    Icon: X,
  },
  denied: {
    label: 'Denied',
    className: 'text-muted-foreground',
    Icon: Ban,
  },
};

interface ToolStatusBadgeProps {
  status: ToolStatus;
  className?: string;
}

export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const { Icon } = config;
  return (
    <span className={cn('inline-flex flex-shrink-0 items-center', config.className, className)}>
      <Icon className={cn('size-3.5', status === 'running' && 'animate-spin')} aria-hidden="true" />
      <span className="sr-only">{config.label}</span>
    </span>
  );
}
