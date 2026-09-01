import type { ReactNode } from 'react';

import { cn } from '../../../utils/cn';

type SettingsRowProps = { label: string; description?: string; children: ReactNode; className?: string };

export default function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  const descriptionNode = description ? (
    <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
  ) : null;
  const rowClass = ['flex items-center justify-between gap-4', 'px-4 py-4'].join(' ');
  const labelClass = ['text-sm font-medium', 'text-foreground'].join(' ');

  return (
    <div className={cn(rowClass, className)}>
      <div className="min-w-0 flex-1">
        <div className={labelClass}>{label}</div>
        {descriptionNode}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
