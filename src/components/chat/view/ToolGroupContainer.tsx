import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage, Provider, CodeEditorDiffInfo  } from '../types/types';
import type { Project } from '../../../types/app';
import { assignMessageKeys } from '../utils/messageKeys';
import { hasFailedResult } from '../utils/toolGrouping';
import type { ToolGroupItem } from '../utils/toolGrouping';
import { toolOutputDensityRules } from '../utils/toolOutputDensity';
import type { ToolOutputDensity } from '../utils/toolOutputDensity';
import { getToolConfig, rendersCommandRow } from '../tools';

import MessageComponent from './MessageComponent';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolGroupContainerProps {
  group: ToolGroupItem;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onShowSettings?: () => void;
  density?: ToolOutputDensity;
  showImagePreviews?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);
  // The runtime's shell tool has no one-line config of its own (it renders as
  // a command row), so the preview reads the command straight off the input.
  const command = parsedInput && typeof parsedInput === 'object' && 'command' in parsedInput
    ? String((parsedInput as { command?: unknown }).command || '')
    : '';

  return String(value || command || title || message.displayText || message.content || '').trim();
}

function getToolGroupIcon(icon: string | undefined, toolName: string): string {
  if (icon === 'terminal' || rendersCommandRow(toolName)) {
    return '$';
  }

  return icon || toolName.slice(0, 1).toUpperCase();
}

export default function ToolGroupContainer({
  group,
  prevMessage,
  createDiff,
  onFileOpen,
  onShowSettings,
  density,
  showImagePreviews = true,
  selectedProject,
  provider,
}: ToolGroupContainerProps) {
  const keyOf = assignMessageKeys(group.messages);
  // A failure never hides behind a count: the row says so at every level.
  // Whether it also unfolds is the level's call - compact keeps it folded.
  const containsFailure = group.messages.some(hasFailedResult);
  const opensForFailure = containsFailure && toolOutputDensityRules(density).failureOpens;
  const [isExpanded, setIsExpanded] = useState(opensForFailure);
  useEffect(() => {
    // A run that fails while streaming unfolds at that moment, not on remount.
    if (opensForFailure) setIsExpanded(true);
  }, [opensForFailure]);
  const { t } = useTranslation('chat');
  const config = getToolConfig(group.toolName).input;
  const label = config.label || group.toolName;
  const iconClass = config.colorScheme?.icon || 'text-muted-foreground';
  const icon = getToolGroupIcon(config.icon, group.toolName);

  const preview = useMemo(() => {
    const visiblePreviews = group.messages
      .slice(0, 2)
      .map(getToolInputPreview)
      .filter(Boolean);

    const extraCount = group.messages.length - visiblePreviews.length;
    const previewText = visiblePreviews.join(', ');

    if (!previewText) {
      return extraCount > 0 ? `+${extraCount} more` : '';
    }

    return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
  }, [group.messages]);

  return (
    <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={group.timestamp || undefined}>
      <button
        type="button"
        // One quiet line. A tool call is scaffolding around the answer, so it
        // gets a row, not a card: no rail, no fill, no padding block. The status
        // colour moves onto the icon, which is where the eye already goes.
        className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/30"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className={`${iconClass} shrink-0 text-xs font-medium`}>{icon}</span>
        <span className="min-w-0 shrink-0 text-xs font-medium text-foreground">{label}</span>
        {group.messages.length > 1 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
            ×{group.messages.length}
          </span>
        )}
        {preview && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground/80">{preview}</span>
        )}
        {containsFailure && (
          <span className="shrink-0 text-[11px] text-destructive">{t('tools.error')}</span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 sm:space-y-4">
          {group.messages.map((message, index) => (
            <MessageComponent
              key={keyOf(message)}
              message={message}
              prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              density={density}
              showImagePreviews={showImagePreviews}
              selectedProject={selectedProject}
              provider={provider}
            />
          ))}
        </div>
      )}
    </div>
  );
}
