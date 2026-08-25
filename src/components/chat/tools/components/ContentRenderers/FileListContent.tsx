import React from 'react';

interface FileListItem {
  path: string;
  onClick?: () => void;
}

interface FileListContentProps {
  files: string[] | FileListItem[];
  onFileClick?: (filePath: string) => void;
  title?: string;
}

/**
 * Renders a compact list of clickable file paths
 * Used by: Grep/Glob results
 */
export const FileListContent: React.FC<FileListContentProps> = ({
  files,
  onFileClick,
  title
}) => {
  return (
    <div>
      {title && (
        <div className="mb-1 text-xs text-muted-foreground">
          {title}
        </div>
      )}
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
        {files.map((file, index) => {
          const filePath = typeof file === 'string' ? file : file.path;
          const handleClick = typeof file === 'string'
            ? () => onFileClick?.(file)
            : file.onClick;

          return (
            <div key={index} className="min-w-0">
              <button
                onClick={handleClick}
                className="block max-w-full truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
                title={filePath}
              >
                {filePath}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
