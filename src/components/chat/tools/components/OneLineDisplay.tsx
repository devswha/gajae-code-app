import React, { useState } from 'react';

import { copyTextToClipboard } from '../../../../utils/clipboard';

import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

type ActionType = 'copy' | 'open-file' | 'none';

interface OneLineDisplayProps {
  toolName: string;
  icon?: string;
  label?: string;
  value: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  style?: string;
  wrapText?: boolean;
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    border?: string;
    icon?: string;
  };
  status?: ToolStatus;
}

/**
 * Unified one-line display for simple tool inputs and results
 * Used by: Bash, Read, Grep/Glob (minimized), TodoRead, etc.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  toolName,
  icon,
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  style,
  wrapText = false,
  colorScheme = {
    primary: 'text-foreground',
    secondary: 'text-muted-foreground',
    background: '',
    border: 'border-border',
    icon: 'text-muted-foreground',
  },
  status,
}) => {
  const [copied, setCopied] = useState(false);
  const isTerminal = style === 'terminal';

  const handleAction = async () => {
    if (action === 'copy' && value) {
      const didCopy = await copyTextToClipboard(value);
      if (!didCopy) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (onAction) {
      onAction();
    }
  };

  const renderCopyButton = () => (
    <button
      onClick={handleAction}
      className="ml-1 flex-shrink-0 text-muted-foreground/40 opacity-0 transition-all hover:text-muted-foreground group-hover:opacity-100"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <svg className="h-3 w-3 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );

  // Terminal style
  if (isTerminal) {
    return (
      <div className="group my-1">
        <div className="flex items-start gap-1.5">
          {status && <ToolStatusBadge status={status} className="mt-0.5" />}
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="flex-shrink-0 text-xs font-medium text-foreground">{label || toolName}</span>
            <code className={`min-w-0 flex-1 font-mono text-xs text-muted-foreground ${wrapText ? 'whitespace-pre-wrap break-all' : 'block truncate'}`}>
              <span className="select-none">$ </span>{value}
            </code>
            {action === 'copy' && renderCopyButton()}
          </div>
        </div>
        {secondary && (
          <div className="ml-7 mt-1">
            <span className="text-[11px] italic text-muted-foreground/60">
              {secondary}
            </span>
          </div>
        )}
      </div>
    );
  }

  // File open style
  if (action === 'open-file') {
    const displayName = value.split('/').pop() || value;
    return (
      <div className={'group flex items-center gap-1.5 py-0.5'}>
        {status && <ToolStatusBadge status={status} />}
        <span className="flex-shrink-0 text-xs font-medium text-foreground">{label || toolName}</span>
        <button
          onClick={handleAction}
          className="truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
          title={value}
        >
          {displayName}
        </button>
      </div>
    );
  }

  // Default one-line style
  return (
    <div className={`group flex items-center gap-1.5 ${colorScheme.background || ''} py-0.5`}>
      {status && <ToolStatusBadge status={status} />}
      {icon && icon !== 'terminal' && (
        <span className={`${colorScheme.icon} flex-shrink-0 text-xs`}>{icon}</span>
      )}
      {(label || toolName) && (
        <span className="flex-shrink-0 text-xs font-medium text-foreground">{label || toolName}</span>
      )}
      <span className={`font-mono text-xs text-muted-foreground ${wrapText ? 'whitespace-pre-wrap break-all' : 'truncate'} min-w-0 flex-1 ${colorScheme.primary}`}>
        {value}
      </span>
      {secondary && (
        <span className={`text-[11px] ${colorScheme.secondary} flex-shrink-0 italic`}>
          {secondary}
        </span>
      )}
      {action === 'copy' && renderCopyButton()}
    </div>
  );
};
