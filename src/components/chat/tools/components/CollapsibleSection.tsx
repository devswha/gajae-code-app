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

/**
 * Reusable collapsible section with consistent styling
 */
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
  return (
    <Collapsible defaultOpen={open} className={cn('group/section rounded-lg group-data-[state=open]/section:border group-data-[state=open]/section:border-border', className)}>
      {/* When there's a clickable title (Edit/Write), only the chevron toggles collapse */}
      {onTitleClick ? (
        <div className="flex cursor-default select-none items-center gap-1.5 py-0.5 text-xs group-data-[state=open]/section:sticky group-data-[state=open]/section:top-0 group-data-[state=open]/section:z-10 group-data-[state=open]/section:-mx-1 group-data-[state=open]/section:bg-background group-data-[state=open]/section:px-1">
          <CollapsibleTrigger className="flex flex-shrink-0 items-center p-0.5 text-muted-foreground hover:text-foreground">
            <svg
              className="h-3 w-3 transition-transform duration-150 group-data-[state=open]/section:rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </CollapsibleTrigger>
          {badge && <span className="flex-shrink-0">{badge}</span>}
          {toolName && (
            <span className="flex-shrink-0 font-medium text-muted-foreground">{toolName}</span>
          )}
          {toolName && (
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
          )}
          <button
            onClick={onTitleClick}
            className="flex-1 truncate text-left font-mono text-muted-foreground transition-colors hover:text-primary hover:underline"
          >
            {title}
          </button>
          {action && <span className="ml-1 flex-shrink-0">{action}</span>}
        </div>
      ) : (
        <CollapsibleTrigger className="flex w-full select-none items-center gap-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground group-data-[state=open]/section:sticky group-data-[state=open]/section:top-0 group-data-[state=open]/section:z-10 group-data-[state=open]/section:-mx-1 group-data-[state=open]/section:bg-background group-data-[state=open]/section:px-1">
          <svg
            className="h-3 w-3 flex-shrink-0 transition-transform duration-150 group-data-[state=open]/section:rotate-90"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {badge && <span className="flex-shrink-0">{badge}</span>}
          {toolName && (
            <span className="flex-shrink-0 font-medium">{toolName}</span>
          )}
          {toolName && (
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
          )}
          <span className="flex-1 truncate text-left font-mono text-muted-foreground">{title}</span>
          {action && <span className="ml-1 flex-shrink-0">{action}</span>}
        </CollapsibleTrigger>
      )}

      <CollapsibleContent className="group-data-[state=open]/section:border-t group-data-[state=open]/section:border-border">
        <div className="mt-1.5 pl-[18px]">
          {outputLabel && (
            <div className="mb-2 flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{outputLabel}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
