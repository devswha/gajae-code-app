import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';

import { copyTextToClipboard } from '../../../../utils/clipboard';
import { cn } from '../../../../utils/cn';

import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

interface BashCommandDisplayProps {
  command: string;
  description?: string;
  output?: string;
  isError?: boolean;
  status?: ToolStatus;
  defaultOpen?: boolean;
}

interface CommandRowProps {
  command: string;
  copied: boolean;
  hasOutput: boolean;
  isRunning: boolean;
  lineCount: number;
  onCopy: (event: React.MouseEvent) => void;
  onToggle: () => void;
  open: boolean;
  status?: ToolStatus;
}

function CommandRow({ command, copied, hasOutput, isRunning, lineCount, onCopy, onToggle, open, status }: CommandRowProps) {
  return (
    <div
      role={hasOutput ? 'button' : undefined}
      tabIndex={hasOutput ? 0 : undefined}
      aria-expanded={hasOutput ? open : undefined}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (hasOutput && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'flex items-center gap-2 px-1 py-0.5 outline-hidden',
        open && 'px-3 py-2',
        hasOutput && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      {!open && status && <ToolStatusBadge status={status} />}
      {!open && (
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200',
            open && 'rotate-90',
            !hasOutput && 'opacity-0',
          )}
        />
      )}
      <span className="shrink-0 font-mono text-xs text-muted-foreground select-none">$</span>
      <code className={cn('min-w-0 flex-1 font-mono text-xs text-foreground', open ? 'break-all whitespace-pre-wrap' : 'truncate')}>
        {command}
      </code>
      {!open && hasOutput && !isRunning && (
        <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums transition-opacity group-hover/cmd:opacity-0">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      )}
      <button
        onClick={onCopy}
        onKeyDown={(event) => event.stopPropagation()}
        className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-all group-hover/cmd:opacity-100 hover:bg-foreground/10 hover:text-foreground focus:opacity-100"
        title="Copy command"
        aria-label="Copy command"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-foreground" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export const BashCommandDisplay: React.FC<BashCommandDisplayProps> = ({
  command,
  description,
  output,
  isError = false,
  status,
  defaultOpen = false,
}) => {
  const text = (output || '').replace(/\s+$/, '');
  const hasOutput = text.length > 0;
  const lineCount = hasOutput ? text.split('\n').length : 0;
  // Output that is already here decides the first paint; output that arrives
  // later (a live run) is caught by the effect, once, so a row the reader has
  // since folded by hand is not reopened by every chunk.
  const startsOpen = hasOutput && (defaultOpen || isError);
  const [open, setOpen] = useState(startsOpen);
  const [copied, setCopied] = useState(false);
  const autoOpenHandled = useRef(startsOpen);

  useEffect(() => {
    const shouldOpen = hasOutput && (defaultOpen || isError);
    if (!autoOpenHandled.current && shouldOpen) {
      autoOpenHandled.current = true;
      setOpen(true);
    }
  }, [hasOutput, defaultOpen, isError]);

  const toggle = () => {
    if (!hasOutput) return;
    setOpen((previous) => !previous);
  };
  const copyCommand = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!await copyTextToClipboard(command)) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const isRunning = status === 'running';

  return (
    <div
      className={cn(
        'group/cmd overflow-hidden rounded-lg transition-colors duration-200',
        hasOutput && !open && 'hover:bg-muted/30',
        open && 'border border-border bg-card',
      )}
    >
      {open && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs">
          {status && <ToolStatusBadge status={status} />}
          <span className="font-medium text-foreground">Bash</span>
        </div>
      )}
      <CommandRow command={command} copied={copied} hasOutput={hasOutput} isRunning={isRunning} lineCount={lineCount} onCopy={copyCommand} onToggle={toggle} open={open} status={status} />
      {description && !open && <div className="truncate px-2.5 pb-1.5 pl-[2.4rem] text-[11px] text-muted-foreground/70 italic">{description}</div>}
      {open && hasOutput && (
        <div className="settings-content-enter border-t border-border">
          {description && <div className="px-3 pt-2 text-[11px] text-muted-foreground/70 italic">{description}</div>}
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Output</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <pre className={cn('max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap', isError ? 'text-destructive' : 'text-muted-foreground')}>
            {text}
          </pre>
        </div>
      )}
    </div>
  );
};
