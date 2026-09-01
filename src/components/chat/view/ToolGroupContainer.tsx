import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage, Provider, CodeEditorDiffInfo  } from '../types/types';
import type { Project } from '../../../types/app';
import type { ToolGroupItem } from '../utils/toolGrouping';
import { getToolConfig } from '../tools';

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
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
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

  return String(value || title || message.displayText || message.content || '').trim();
}

function getToolGroupIcon(icon: string | undefined, toolName: string): string {
  if (icon === 'terminal') {
    return '$';
  }

  return icon || toolName.slice(0, 1).toUpperCase();
}

export default function ToolGroupContainer({
  group,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  showRawParameters,
  showThinking,
  showImagePreviews = true,
  selectedProject,
  provider,
}: ToolGroupContainerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
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
        <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
          ×{group.messages.length}
        </span>
        {preview && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground/80">{preview}</span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 sm:space-y-4">
          {group.messages.map((message, index) => (
            <MessageComponent
              key={getMessageKey(message)}
              message={message}
              prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
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
