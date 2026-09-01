import React, { useMemo } from 'react';

type DiffLine = { type: string; content: string; lineNum: number };

interface ToolDiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileClick?: () => void;
  badge?: string;
  badgeColor?: 'gray' | 'green';
}

function diffAppearance(type: string) {
  if (type === 'removed') return { className: 'bg-diff-removed text-diff-removed-foreground', marker: '-' };
  if (type === 'added') return { className: 'bg-diff-added text-diff-added-foreground', marker: '+' };
  return { className: 'text-muted-foreground', marker: ' ' };
}

function DiffRows({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="font-mono text-xs leading-[18px]">
      {lines.map((line, index) => {
        const appearance = diffAppearance(line.type);
        return (
          <div key={index} className={`flex ${appearance.className}`}>
            <span className="w-6 shrink-0 text-center select-none">{appearance.marker}</span>
            <span className="flex-1 px-2 whitespace-pre-wrap">{line.content}</span>
          </div>
        );
      })}
    </div>
  );
}

export const ToolDiffViewer: React.FC<ToolDiffViewerProps> = ({
  oldContent,
  newContent,
  filePath,
  createDiff,
  onFileClick,
  badge = 'Diff',
  badgeColor = 'gray',
}) => {
  const lines = useMemo(() => {
    if (oldContent === undefined || newContent === undefined) return [];
    return createDiff(oldContent, newContent);
  }, [createDiff, oldContent, newContent]);
  const badgeClasses = badgeColor === 'green' ? 'bg-diff-added text-diff-added-foreground' : 'bg-muted text-muted-foreground';
  const fileLabel = onFileClick ? (
    <button onClick={onFileClick} className="cursor-pointer truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary">
      {filePath}
    </button>
  ) : (
    <span className="truncate font-mono text-xs text-muted-foreground">{filePath}</span>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-2.5 py-1">
        {fileLabel}
        <span className={`ml-2 shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${badgeClasses}`}>{badge}</span>
      </div>
      <DiffRows lines={lines} />
    </div>
  );
};
