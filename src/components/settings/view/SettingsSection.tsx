import type { ReactNode } from 'react';

import { cn } from '../../../utils/cn';

type SettingsSectionProps = { title: string; description?: string; children: ReactNode; className?: string };

export default function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  const descriptionNode = description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null;
  const headingClass = ['text-sm font-semibold tracking-wider', 'text-muted-foreground uppercase'].join(' ');

  return (
    <div className={cn(['space-y-3'].join(' '), className)}>
      <div>
        <h3 className={headingClass}>{title}</h3>
        {descriptionNode}
      </div>
      {children}
    </div>
  );
}
