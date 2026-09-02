import React from 'react';

import { CollapsibleSection } from './CollapsibleSection';
import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

interface ToolCallRowProps {
  toolName: string;
  label?: string;
  value: string;
  secondary?: string;
  output: string;
  isError?: boolean;
  status?: ToolStatus;
  /** Start unfolded (the detailed density level); a failure unfolds regardless. */
  defaultOpen?: boolean;
}

/**
 * A tool call and the output it produced, as one block.
 *
 * This is what the runtime's own TUI does for these tools
 * (`mergeCallAndResult`), and what the app already did for shell commands: the
 * call is the header, the output folds inside it. Rendered as two rows instead
 * - a one-line call and a separate card titled "Details" - the transcript
 * doubled in height per call, the second row's title said nothing, and the
 * size of the result was invisible until you opened it.
 *
 * A failure opens by itself and stays red, because a folded failure is a
 * failure nobody reads.
 */
export const ToolCallRow: React.FC<ToolCallRowProps> = ({
  toolName,
  label,
  value,
  secondary,
  output,
  isError = false,
  status,
  defaultOpen = false,
}) => {
  const trimmedOutput = output.trim();
  const lineCount = trimmedOutput.split('\n').length;

  return (
    <div className="py-0.5 pl-2">
      <CollapsibleSection
        toolName={label || toolName}
        title={value}
        open={isError || defaultOpen}
        outputLabel="Output"
        badge={status ? <ToolStatusBadge status={status} /> : undefined}
        action={(
          <span className="flex items-center gap-2">
            {secondary && (
              <span className="truncate text-[11px] text-muted-foreground/60 italic">{secondary}</span>
            )}
            <span className="text-[10px] text-muted-foreground/70 tabular-nums">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          </span>
        )}
      >
        <pre
          className={`max-h-80 overflow-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap ${
            isError ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {trimmedOutput}
        </pre>
      </CollapsibleSection>
    </div>
  );
};
