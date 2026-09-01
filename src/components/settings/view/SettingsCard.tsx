import type { ReactNode } from 'react';

import { cn } from '../../../utils/cn';

type SettingsCardProps = { children: ReactNode; className?: string; divided?: boolean };

export default function SettingsCard({ children, className, divided }: SettingsCardProps) {
  const cardClassName = cn(
    ['rounded-xl border', 'border-border bg-card/50'].join(' '),
    className,
    divided ? ['divide-y', 'divide-border'].join(' ') : undefined,
  );

  return (
    <div className={cardClassName}>{children}</div>
  );
}
