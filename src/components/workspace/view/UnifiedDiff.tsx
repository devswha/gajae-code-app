import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseUnifiedDiff, type UnifiedDiffRow } from '../utils/unifiedDiff';

/** What a row hands to the tab when its comment button is pressed. */
export type DiffCommentRow = {
  rowIndex: number;
  oldLine: number | null;
  newLine: number | null;
  kind: 'context' | 'added' | 'removed';
  content: string;
};

export type UnifiedDiffProps = {
  patch: string;
  /** Offered per row when present: press to start a comment on that line. */
  onLineComment?: (row: DiffCommentRow) => void;
};

export default function UnifiedDiff({ patch, onLineComment }: UnifiedDiffProps) {
  const rows = useMemo(() => parseUnifiedDiff(patch), [patch]);

  return <UnifiedDiffRows rows={rows} onLineComment={onLineComment} />;
}

/** Rows rendered before the remainder hides behind a reveal; a generated
 * file's patch can be thousands of lines and the tab must not paint them. */
const ROW_LIMIT = 500;

export function UnifiedDiffRows({ rows, onLineComment }: { rows: UnifiedDiffRow[]; onLineComment?: (row: DiffCommentRow) => void }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll || rows.length <= ROW_LIMIT ? rows : rows.slice(0, ROW_LIMIT);
  return (
    <div className="overflow-x-auto border-t border-border/60 font-mono text-xs leading-[18px]">
      {visible.map((row, index) => {
        if (row.kind === 'hunk') {
          return <div key={index} className="px-2 text-muted-foreground">{row.content}</div>;
        }
        const appearance = row.kind === 'added'
          ? { className: 'bg-diff-added text-diff-added-foreground', marker: '+' }
          : row.kind === 'removed'
            ? { className: 'bg-diff-removed text-diff-removed-foreground', marker: '-' }
            : { className: 'text-muted-foreground', marker: ' ' };
        return (
          <div key={index} className={`group/line flex min-w-0 ${appearance.className}`}>
            <span className="w-6 shrink-0 text-center select-none">{appearance.marker}</span>
            <span className="w-10 shrink-0 px-1 text-right text-muted-foreground/70 select-none">{row.oldLine ?? ''}</span>
            <span className="w-10 shrink-0 px-1 text-right text-muted-foreground/70 select-none">{row.newLine ?? ''}</span>
            <span className="min-w-0 flex-1 px-2 break-all whitespace-pre-wrap">{row.content}</span>
            {onLineComment && (
              <button
                type="button"
                onClick={() => onLineComment({ rowIndex: index, oldLine: row.oldLine, newLine: row.newLine, kind: row.kind, content: row.content })}
                aria-label={t('workspace.changes.comment.add')}
                title={t('workspace.changes.comment.add')}
                className="mr-1 shrink-0 self-center rounded px-1 text-muted-foreground opacity-60 transition-opacity group-hover/line:opacity-100 hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100"
              >
                <span aria-hidden className="font-sans">+</span>
              </button>
            )}
          </div>
        );
      })}
      {rows.length > ROW_LIMIT && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="block w-full px-2 py-1 text-left font-sans text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          {t('workspace.changes.moreLines', { count: rows.length - ROW_LIMIT })}
        </button>
      )}
    </div>
  );
}
