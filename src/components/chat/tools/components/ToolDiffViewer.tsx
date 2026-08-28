import React, { useMemo } from 'react';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolDiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileClick?: () => void;
  badge?: string;
  badgeColor?: 'gray' | 'green';
}

export const ToolDiffViewer: React.FC<ToolDiffViewerProps> = ({
  oldContent,
  newContent,
  filePath,
  createDiff,
  onFileClick,
  badge = 'Diff',
  badgeColor = 'gray'
}) => {
  const badgeClasses = badgeColor === 'green'
    ? 'bg-diff-added text-diff-added-foreground'
    : 'bg-muted text-muted-foreground';

  const diffLines = useMemo(
    () => {
      if (oldContent === undefined || newContent === undefined) {
        return [];
      }
      return createDiff(oldContent, newContent)
    },
    [createDiff, oldContent, newContent]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-2.5 py-1">
        {onFileClick ? (
          <button
            onClick={onFileClick}
            className="cursor-pointer truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            {filePath}
          </button>
        ) : (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {filePath}
          </span>
        )}
        <span className={`ml-2 shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${badgeClasses}`}>
          {badge}
        </span>
      </div>

      {/* Diff lines */}
      <div className="font-mono text-xs leading-[18px]">
        {diffLines.map((diffLine, i) => {
          const lineClasses = diffLine.type === 'removed'
            ? 'bg-diff-removed text-diff-removed-foreground'
            : diffLine.type === 'added'
              ? 'bg-diff-added text-diff-added-foreground'
              : 'text-muted-foreground';
          const marker = diffLine.type === 'removed'
            ? '-'
            : diffLine.type === 'added'
              ? '+'
              : ' ';

          return (
            <div key={i} className={`flex ${lineClasses}`}>
              <span
                className="w-6 shrink-0 text-center select-none"
              >
                {marker}
              </span>
              <span className="flex-1 px-2 whitespace-pre-wrap">
                {diffLine.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
