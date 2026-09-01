import type { ReactNode } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../../shared/view/ui';

import { CollapsibleSection } from './CollapsibleSection';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  badge?: ReactNode;
  onTitleClick?: () => void;
  children: ReactNode;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
}

function ParameterDisclosure({ rawContent }: { rawContent: string }) {
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
        <svg className="h-2.5 w-2.5 shrink-0 transition-transform duration-150 data-[state=open]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        raw params
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 overflow-hidden rounded border border-border/40 bg-muted p-2 font-mono text-[11px] wrap-break-word whitespace-pre-wrap text-muted-foreground">{rawContent}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CollapsibleDisplay({
  toolName,
  title,
  defaultOpen = false,
  action,
  badge,
  onTitleClick,
  children,
  showRawParameters = false,
  rawContent,
  className = '',
}: CollapsibleDisplayProps) {
  const canShowParameters = showRawParameters && Boolean(rawContent);

  return (
    <div className={`py-0.5 pl-2 ${className}`}>
      <CollapsibleSection title={title} toolName={toolName} open={defaultOpen} action={action} badge={badge} onTitleClick={onTitleClick}>
        {children}
        {canShowParameters ? <ParameterDisclosure rawContent={rawContent!} /> : null}
      </CollapsibleSection>
    </div>
  );
}
