import React from 'react';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import { cn } from '../../../../utils/cn';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
  outputLabel?: string;
}

function Chevron({ shrink = false }: { shrink?: boolean }) {
  const className = shrink
    ? 'h-3 w-3 shrink-0 transition-transform duration-150 group-data-[state=open]/section:rotate-90'
    : 'h-3 w-3 transition-transform duration-150 group-data-[state=open]/section:rotate-90';

  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function SectionDetails({ outputLabel, children }: Pick<CollapsibleSectionProps, 'outputLabel' | 'children'>) {
  return (
    <CollapsibleContent className="group-data-[state=open]/section:border-t group-data-[state=open]/section:border-border">
      <div className="mt-1.5 pl-[18px]">
        {outputLabel && (
          <div className="mb-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{outputLabel}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}
        {children}
      </div>
    </CollapsibleContent>
  );
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  badge,
  onTitleClick,
  children,
  className = '',
  outputLabel,
}) => {
  const headerClass = 'group-data-[state=open]/section:sticky group-data-[state=open]/section:top-0 group-data-[state=open]/section:z-10 group-data-[state=open]/section:-mx-1 group-data-[state=open]/section:bg-background group-data-[state=open]/section:px-1';
  const nameParts = <>
    {badge && <span className="shrink-0">{badge}</span>}
    {toolName && <span className="shrink-0 font-medium">{toolName}</span>}
    {toolName && <span className="shrink-0 text-[10px] text-muted-foreground/40">/</span>}
  </>;
  const trailingAction = action && <span className="ml-1 shrink-0">{action}</span>;

  return (
    <Collapsible defaultOpen={open} className={cn('group/section rounded-lg group-data-[state=open]/section:border group-data-[state=open]/section:border-border', className)}>
      {onTitleClick ? (
        <div className={`flex cursor-default items-center gap-1.5 py-0.5 text-xs select-none ${headerClass}`}>
          <CollapsibleTrigger className="flex shrink-0 items-center p-0.5 text-muted-foreground hover:text-foreground">
            <Chevron />
          </CollapsibleTrigger>
          {badge && <span className="shrink-0">{badge}</span>}
          {toolName && <span className="shrink-0 font-medium text-muted-foreground">{toolName}</span>}
          {toolName && <span className="shrink-0 text-[10px] text-muted-foreground/40">/</span>}
          <button onClick={onTitleClick} className="flex-1 truncate text-left font-mono text-muted-foreground transition-colors hover:text-primary hover:underline">
            {title}
          </button>
          {trailingAction}
        </div>
      ) : (
        <CollapsibleTrigger className={`flex w-full items-center gap-1.5 py-0.5 text-xs text-muted-foreground transition-colors select-none ${headerClass} hover:text-foreground`}>
          <Chevron shrink />
          {nameParts}
          <span className="flex-1 truncate text-left font-mono text-muted-foreground">{title}</span>
          {trailingAction}
        </CollapsibleTrigger>
      )}
      <SectionDetails outputLabel={outputLabel}>{children}</SectionDetails>
    </Collapsible>
  );
};
