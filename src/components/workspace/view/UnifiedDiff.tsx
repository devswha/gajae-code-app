import { useMemo } from 'react';

import { parseUnifiedDiff } from '../utils/unifiedDiff';

export type UnifiedDiffProps = {
  patch: string;
};

export default function UnifiedDiff({ patch }: UnifiedDiffProps) {
  const rows = useMemo(() => parseUnifiedDiff(patch), [patch]);

  return (
    <div className="overflow-x-auto border-t border-border/60 font-mono text-xs leading-[18px]">
      {rows.map((row, index) => {
        if (row.kind === 'hunk') {
          return <div key={index} className="px-2 text-muted-foreground">{row.content}</div>;
        }
        const appearance = row.kind === 'added'
          ? { className: 'bg-diff-added text-diff-added-foreground', marker: '+' }
          : row.kind === 'removed'
            ? { className: 'bg-diff-removed text-diff-removed-foreground', marker: '-' }
            : { className: 'text-muted-foreground', marker: ' ' };
        return (
          <div key={index} className={`flex min-w-0 ${appearance.className}`}>
            <span className="w-6 shrink-0 text-center select-none">{appearance.marker}</span>
            <span className="w-10 shrink-0 px-1 text-right text-muted-foreground/70 select-none">{row.oldLine ?? ''}</span>
            <span className="w-10 shrink-0 px-1 text-right text-muted-foreground/70 select-none">{row.newLine ?? ''}</span>
            <span className="min-w-0 flex-1 px-2 break-all whitespace-pre-wrap">{row.content}</span>
          </div>
        );
      })}
    </div>
  );
}
