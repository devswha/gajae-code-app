import React from 'react';

interface FileListItem { path: string; onClick?: () => void; }
interface FileListContentProps { files: string[] | FileListItem[]; onFileClick?: (filePath: string) => void; title?: string; }

const itemData = (item: string | FileListItem, onFileClick?: (path: string) => void) => (
  typeof item === 'string' ? { path: item, onClick: () => onFileClick?.(item) } : item
);

export const FileListContent: React.FC<FileListContentProps> = ({ files, onFileClick, title }) => (
  <div>
    {title && <div className="mb-1 text-xs text-muted-foreground">{title}</div>}
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
      {files.map((item, index) => {
        const file = itemData(item, onFileClick);
        return <div key={index} className="min-w-0"><button onClick={file.onClick} className="block max-w-full truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary hover:underline" title={file.path}>{file.path}</button></div>;
      })}
    </div>
  </div>
);
