import React from 'react';

import type { SubagentChildTool } from '../../types/types';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';

import { CollapsibleSection } from './CollapsibleSection';
import { ToolStatusBadge } from './ToolStatusBadge';

interface SubagentContainerProps {
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
}

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch':
      return input.file_path?.split('/').pop() || input.file_path || '';
    case 'Grep':
    case 'Glob':
      return input.pattern || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 40 ? `${cmd.slice(0, 40)}...` : cmd;
    case 'Task':
      return input.description || input.subagent_type || '';
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

export const SubagentContainer: React.FC<SubagentContainerProps> = ({
  toolInput,
  toolResult,
  subagentState,
}) => {
  const parsedInput = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  const subagentType = parsedInput?.subagent_type || 'Agent';
  const description = parsedInput?.description || 'Running task';
  const prompt = parsedInput?.prompt || '';
  const { childTools, currentToolIndex, isComplete } = subagentState;
  const currentTool = currentToolIndex >= 0 ? childTools[currentToolIndex] : null;

  const status = toolResult?.isError ? 'error' : isComplete ? 'completed' : 'running';

  return (
    <div className="my-1 border-l border-border py-0.5 pl-3">
      <CollapsibleSection
        title={description}
        toolName={`Subagent / ${subagentType}`}
        open={false}
        badge={<ToolStatusBadge status={status} />}
      >
        {/* Prompt/request to the subagent */}
        {prompt && (
          <div className="mb-2 line-clamp-4 text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">
            {prompt}
          </div>
        )}

        {/* Current tool indicator (while running) */}
        {currentTool && !isComplete && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ToolStatusBadge status="running" />
            <span className="text-muted-foreground/60">Currently:</span>
            <span className="font-medium text-foreground">{currentTool.toolName}</span>
            {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput) && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="truncate font-mono text-muted-foreground">
                  {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Completion status */}
        {isComplete && (
          <div className={`mt-1 flex items-center gap-1.5 text-xs ${toolResult?.isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            <ToolStatusBadge status={status} />
            <span>
              {toolResult?.isError ? 'Failed' : 'Completed'} ({childTools.length} {childTools.length === 1 ? 'tool' : 'tools'})
            </span>
          </div>
        )}

        {/* Tool history (collapsed) */}
        {childTools.length > 0 && (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <svg
                className="h-2.5 w-2.5 shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>View tool history ({childTools.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 space-y-0.5 border-l border-border pl-3">
                {childTools.map((child, index) => (
                  <div key={child.toolId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-4 shrink-0 text-right text-muted-foreground/60">{index + 1}.</span>
                    <span className="font-medium text-foreground">{child.toolName}</span>
                    {getCompactToolDisplay(child.toolName, child.toolInput) && (
                      <span className="truncate font-mono text-muted-foreground/70">
                        {getCompactToolDisplay(child.toolName, child.toolInput)}
                      </span>
                    )}
                    {child.toolResult?.isError && (
                      <span className="shrink-0 text-destructive">(error)</span>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Final result */}
        {isComplete && toolResult && (
          <div className="mt-2 text-xs text-muted-foreground">
            {(() => {
              let content = toolResult.content;

              // Handle JSON string that needs parsing
              if (typeof content === 'string') {
                try {
                  const parsed = JSON.parse(content);
                  if (Array.isArray(parsed)) {
                    // Extract text from array format like [{"type":"text","text":"..."}]
                    const textParts = parsed
                      .filter((p: any) => p.type === 'text' && p.text)
                      .map((p: any) => p.text);
                    if (textParts.length > 0) {
                      content = textParts.join('\n');
                    }
                  }
                } catch {
                  // Not JSON, use as-is
                }
              } else if (Array.isArray(content)) {
                // Direct array format
                const textParts = content
                  .filter((p: any) => p.type === 'text' && p.text)
                  .map((p: any) => p.text);
                if (textParts.length > 0) {
                  content = textParts.join('\n');
                }
              }

              return typeof content === 'string' ? (
                <div className="line-clamp-6 wrap-break-word whitespace-pre-wrap">
                  {content}
                </div>
              ) : content ? (
                <pre className="line-clamp-6 font-mono text-xs wrap-break-word whitespace-pre-wrap">
                  {JSON.stringify(content, null, 2)}
                </pre>
              ) : null;
            })()}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};
