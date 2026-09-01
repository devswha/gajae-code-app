import React from 'react';

import type { SubagentChildTool } from '../../types/types';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';

import { CollapsibleSection } from './CollapsibleSection';
import { ToolStatusBadge } from './ToolStatusBadge';

interface SubagentContainerProps { toolInput: unknown; toolResult?: { content?: unknown; isError?: boolean } | null; subagentState: { childTools: SubagentChildTool[]; currentToolIndex: number; isComplete: boolean } }

type ToolInput = Record<string, any>;

function objectFromInput(input: unknown): ToolInput {
  if (typeof input !== 'string') return (input || {}) as ToolInput;
  try { return JSON.parse(input); } catch { return {}; }
}

function toolSummary(name: string, rawInput: unknown): string {
  const input = objectFromInput(rawInput);
  if (['Read', 'Write', 'Edit', 'ApplyPatch'].includes(name)) return input.file_path?.split('/').pop() || input.file_path || '';
  if (name === 'Grep' || name === 'Glob') return input.pattern || '';
  if (name === 'Bash') {
    const command = input.command || '';
    return command.length > 40 ? `${command.slice(0, 40)}...` : command;
  }
  if (name === 'Task') return input.description || input.subagent_type || '';
  if (name === 'WebFetch' || name === 'WebSearch') return input.url || input.query || '';
  return '';
}

function resultContent(value: unknown): unknown {
  const textFromParts = (parts: any[]) => {
    const text = parts.filter((part: any) => part.type === 'text' && part.text).map((part: any) => part.text);
    return text.length > 0 ? text.join('\n') : undefined;
  };
  if (Array.isArray(value)) return textFromParts(value) ?? value;
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? textFromParts(parsed) ?? value : value;
  } catch { return value; }
}

function FinalResult({ value }: { value: unknown }) {
  const content = resultContent(value);
  if (typeof content === 'string') return <div className="line-clamp-6 wrap-break-word whitespace-pre-wrap">{content}</div>;
  return content ? <pre className="line-clamp-6 font-mono text-xs wrap-break-word whitespace-pre-wrap">{JSON.stringify(content, null, 2)}</pre> : null;
}

export const SubagentContainer: React.FC<SubagentContainerProps> = ({ toolInput, toolResult, subagentState }) => {
  const input = objectFromInput(toolInput);
  const { childTools, currentToolIndex, isComplete } = subagentState;
  const activeTool = currentToolIndex >= 0 ? childTools[currentToolIndex] : null;
  const status = toolResult?.isError ? 'error' : isComplete ? 'completed' : 'running';
  const activeSummary = activeTool ? toolSummary(activeTool.toolName, activeTool.toolInput) : '';

  return <div className="my-1 border-l border-border py-0.5 pl-3">
    <CollapsibleSection title={input.description || 'Running task'} toolName={`Subagent / ${input.subagent_type || 'Agent'}`} open={false} badge={<ToolStatusBadge status={status} />}>
      {input.prompt && <div className="mb-2 line-clamp-4 text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">{input.prompt}</div>}
      {activeTool && !isComplete && <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ToolStatusBadge status="running" />
        <span className="text-muted-foreground/60">Currently:</span>
        <span className="font-medium text-foreground">{activeTool.toolName}</span>
        {activeSummary && <><span className="text-muted-foreground/40">/</span><span className="truncate font-mono text-muted-foreground">{activeSummary}</span></>}
      </div>}
      {isComplete && <div className={`mt-1 flex items-center gap-1.5 text-xs ${toolResult?.isError ? 'text-destructive' : 'text-muted-foreground'}`}>
        <ToolStatusBadge status={status} />
        <span>{toolResult?.isError ? 'Failed' : 'Completed'} ({childTools.length} {childTools.length === 1 ? 'tool' : 'tools'})</span>
      </div>}
      {childTools.length > 0 && <Collapsible className="mt-2">
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <svg className="h-2.5 w-2.5 shrink-0 transition-transform duration-150 data-[state=open]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span>View tool history ({childTools.length})</span>
        </CollapsibleTrigger>
        <CollapsibleContent><div className="mt-1 space-y-0.5 border-l border-border pl-3">
          {childTools.map((child, index) => {
            const summary = toolSummary(child.toolName, child.toolInput);
            return <div key={child.toolId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-4 shrink-0 text-right text-muted-foreground/60">{index + 1}.</span>
              <span className="font-medium text-foreground">{child.toolName}</span>
              {summary && <span className="truncate font-mono text-muted-foreground/70">{summary}</span>}
              {child.toolResult?.isError && <span className="shrink-0 text-destructive">(error)</span>}
            </div>;
          })}
        </div></CollapsibleContent>
      </Collapsible>}
      {isComplete && toolResult && <div className="mt-2 text-xs text-muted-foreground"><FinalResult value={toolResult.content} /></div>}
    </CollapsibleSection>
  </div>;
};
