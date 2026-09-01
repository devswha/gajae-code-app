import React from 'react';
import { ChevronsUpDown, FileText } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, CardFooter, Button, Collapsible, CollapsibleTrigger, CollapsibleContent, Shimmer } from '../../../../shared/view/ui';
import { usePermission } from '../../../../contexts/PermissionContext';

import { MarkdownContent } from './ContentRenderers';

interface PlanDisplayProps { title: string; content: string; defaultOpen?: boolean; isStreaming?: boolean; showRawParameters?: boolean; rawContent?: string; toolName: string; toolId?: string }

function RawParameters({ value }: { value: string }) {
  return <Collapsible className="mt-3">
    <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
      <svg className="h-2.5 w-2.5 shrink-0 transition-transform duration-150 data-[state=open]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      raw params
    </CollapsibleTrigger>
    <CollapsibleContent><pre className="mt-1 overflow-hidden rounded border border-border/40 bg-muted p-2 font-mono text-[11px] wrap-break-word whitespace-pre-wrap text-muted-foreground">{value}</pre></CollapsibleContent>
  </Collapsible>;
}

export const PlanDisplay: React.FC<PlanDisplayProps> = ({ title, content, defaultOpen = false, isStreaming = false, showRawParameters = false, rawContent, toolName: _toolName }) => {
  const permissions = usePermission();
  const pendingRequest = permissions?.pendingPermissionRequests.find(({ toolName }) => toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode');
  const decide = (allow: boolean) => {
    if (!pendingRequest || !permissions) return;
    permissions.handlePermissionDecision(pendingRequest.requestId, allow ? { allow: true } : { allow: false, message: 'User asked to revise the plan' });
  };

  return <Collapsible defaultOpen={defaultOpen}>
    <Card className="my-1 flex flex-col rounded-lg border border-border bg-card shadow-none">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 px-4 pt-4 pb-0">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">{isStreaming ? <Shimmer>{title}</Shimmer> : title}</CardTitle>
        </div>
        <CollapsibleTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"><ChevronsUpDown className="h-4 w-4" /><span className="sr-only">Toggle plan</span></CollapsibleTrigger>
      </CardHeader>
      <CollapsibleContent><CardContent className="px-4 pt-3 pb-4">
        {content ? <MarkdownContent content={content} className="prose prose-sm max-w-none text-muted-foreground" /> : isStreaming ? <div className="py-2"><Shimmer>Generating plan...</Shimmer></div> : null}
        {showRawParameters && rawContent && <RawParameters value={rawContent} />}
      </CardContent></CollapsibleContent>
      {pendingRequest && <CardFooter className="justify-end gap-2 border-t border-border/40 px-4 pt-3 pb-3">
        <Button variant="ghost" size="sm" onClick={() => decide(false)} className="text-muted-foreground">Revise</Button>
        <Button size="sm" onClick={() => decide(true)}>Build{' '}<kbd className="ml-1 rounded bg-primary-foreground/20 px-1 py-0.5 font-mono text-[10px]">⌘↩</kbd></Button>
      </CardFooter>}
    </Card>
  </Collapsible>;
};
