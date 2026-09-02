import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type { SessionStore } from '../../../stores/useSessionStore';
import { useLastTurnChanges, type LastTurnFile } from '../hooks/useLastTurnChanges';
import { useProjectChanges, type ProjectChange } from '../hooks/useProjectChanges';
import { diffCommentLine, formatDiffComment } from '../utils/diffComment';

import UnifiedDiff, { UnifiedDiffRows } from './UnifiedDiff';
import type { DiffCommentRow } from './UnifiedDiff';

export type WorkspaceChangesTabProps = {
  projectId?: string;
  projectPath?: string;
  projectName?: string;
  sessionId?: string;
  sessionStore: SessionStore;
  lastTurnRunning?: boolean;
  /** Appends a line comment to the chat composer as the next message's draft. */
  onComposerInsert?: (text: string) => boolean;
  active: boolean;
};

const statusAppearance: Record<ProjectChange['status'], { label: string; className: string }> = {
  added: { label: 'A', className: 'bg-diff-added text-diff-added-foreground' },
  modified: { label: 'M', className: 'bg-muted text-muted-foreground' },
  deleted: { label: 'D', className: 'bg-diff-removed text-diff-removed-foreground' },
  renamed: { label: 'R', className: 'bg-diff-added text-diff-added-foreground' },
  untracked: { label: '?', className: 'bg-muted text-muted-foreground' },
};

export default function WorkspaceChangesTab({
  projectId,
  projectPath,
  projectName,
  sessionId,
  sessionStore,
  lastTurnRunning = false,
  onComposerInsert,
  active,
}: WorkspaceChangesTabProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'workingTree' | 'lastTurn'>('workingTree');
  const { state, refresh: refreshWorkingTree } = useProjectChanges(projectId, active && scope === 'workingTree');
  const { files: lastTurnFiles, pending: lastTurnPending, refresh: refreshLastTurn, status: lastTurnStatus } = useLastTurnChanges(sessionStore, sessionId, active && scope === 'lastTurn');
  const [openPath, setOpenPath] = useState<string | null>(null);

  const openInEditor = useCallback((path: string) => {
    if (!projectPath) {
      return;
    }
    const absolutePath = path.startsWith('/') ? path : `${projectPath.replace(/\/$/, '')}/${path}`;
    void api.system.openFile(absolutePath);
  }, [projectPath]);

  const refresh = () => {
    if (scope === 'workingTree') {
      void refreshWorkingTree();
    } else {
      refreshLastTurn();
    }
  };

  return (
    <div className="h-full overflow-y-auto px-3 py-3 text-xs">
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
            {t('workspace.changes.title')}
          </h3>
          <div className="flex items-center gap-0.5">
            <div className="flex rounded border border-border/60 p-px">
              {(['workingTree', 'lastTurn'] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    setScope(candidate);
                    setOpenPath(null);
                  }}
                  aria-pressed={scope === candidate}
                  className={`rounded px-1.5 py-1 text-[10px] transition-colors ${scope === candidate ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t(`workspace.changes.scope.${candidate}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refresh}
              title={t('workspace.changes.refreshLabel')}
              aria-label={t('workspace.changes.refreshLabel')}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <RefreshCw className={`h-3 w-3 ${scope === 'workingTree' && state.kind === 'loading' ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="rounded-md border border-border/60">
          {scope === 'lastTurn' ? (
            !sessionId ? (
              <div className="m-2 rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-muted-foreground">
                {t('workspace.changes.noSession')}
              </div>
            ) : lastTurnStatus === 'loading' || (lastTurnRunning && lastTurnPending) ? (
              <p className="px-2.5 py-2 text-muted-foreground">{t('workspace.changes.loading')}</p>
            ) : lastTurnStatus === 'error' ? (
              <p className="px-2.5 py-2 text-muted-foreground">{t('workspace.changes.unavailable')}</p>
            ) : lastTurnFiles.length === 0 ? (
              <div className="m-2 rounded-md border border-dashed border-border/70 px-3 py-4 text-center">
                <p className="font-medium text-foreground">{t('workspace.changes.emptyTurn')}</p>
                <p className="mt-0.5 text-muted-foreground">{t('workspace.changes.emptyTurnHint')}</p>
              </div>
            ) : (
              lastTurnFiles.map((file, index) => (
                <LastTurnChangeRow
                  key={`${index}:${file.path}`}
                  file={file}
                  rowKey={`${index}:${file.path}`}
                  openPath={openPath}
                  onSetOpenPath={setOpenPath}
                  onOpenInEditor={openInEditor}
                  onComposerInsert={onComposerInsert}
                  t={t}
                />
              ))
            )
          ) : state.kind === 'ready' ? (
            <>
              <div className="truncate border-b border-border/60 px-2.5 py-1.5 text-muted-foreground">
                {state.changes.branch ?? projectName ?? '—'} · {t('workspace.changes.files', { count: state.changes.truncated ? state.changes.totalFiles : state.changes.files.length })}
              </div>
              {state.changes.truncated && (
                <p className="border-b border-border/60 px-2.5 py-1.5 text-muted-foreground">{t('workspace.changes.truncated', { shown: state.changes.files.length, total: state.changes.totalFiles })}</p>
              )}
              {!state.changes.hasCommits && (
                <p className="border-b border-border/60 px-2.5 py-1.5 text-muted-foreground">{t('workspace.changes.noCommits')}</p>
              )}
              {state.changes.files.length === 0 ? (
                <div className="m-2 rounded-md border border-dashed border-border/70 px-3 py-4 text-center">
                  <p className="font-medium text-foreground">{t('workspace.changes.empty')}</p>
                  <p className="mt-0.5 text-muted-foreground">{t('workspace.changes.emptyHint')}</p>
                </div>
              ) : (
                state.changes.files.map((file) => (
                  <ChangeRow
                    key={file.path}
                    file={file}
                    openPath={openPath}
                    onSetOpenPath={setOpenPath}
                    onOpenInEditor={openInEditor}
                    onComposerInsert={onComposerInsert}
                    t={t}
                  />
                ))
              )}
            </>
          ) : (
            <p className="px-2.5 py-2 text-muted-foreground">
              {state.kind === 'not-a-repository' && t('workspace.changes.notRepo')}
              {state.kind === 'unavailable' && t('workspace.changes.unavailable')}
              {(state.kind === 'loading' || state.kind === 'idle') && t('workspace.changes.loading')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export const ChangeRow = memo(function ChangeRow({
  file,
  openPath,
  onSetOpenPath,
  onOpenInEditor,
  onComposerInsert,
  t,
}: {
  file: ProjectChange;
  openPath: string | null;
  onSetOpenPath: (path: string | null) => void;
  onOpenInEditor: (path: string) => void;
  onComposerInsert?: (text: string) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [commentRow, setCommentRow] = useState<DiffCommentRow | null>(null);
  const expanded = openPath === file.path;
  const onToggle = () => onSetOpenPath(expanded ? null : file.path);
  const appearance = statusAppearance[file.status];
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className={`rounded px-1 font-mono text-[10px] font-medium ${appearance.className}`}>{appearance.label}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
            {file.oldPath ? <>{file.oldPath} <span className="text-muted-foreground">{t('workspace.changes.renameArrow')}</span> {file.path}</> : file.path}
          </span>
          <span className="shrink-0 font-mono text-[11px]">
            {file.additions > 0 && <span className="text-diff-added-foreground">+{file.additions}</span>}
            {file.deletions > 0 && <span className="ml-1 text-diff-removed-foreground">-{file.deletions}</span>}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onOpenInEditor(file.path)}
          title={t('workspace.changes.openInEditor')}
          aria-label={t('workspace.changes.openInEditor')}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        file.patch !== null
          ? <>
              <UnifiedDiff patch={file.patch} onLineComment={onComposerInsert ? setCommentRow : undefined} />
              {commentRow && (
                <LineCommentBox
                  key={commentRow.rowIndex}
                  path={file.path}
                  row={commentRow}
                  onSubmit={(text) => {
                    if (onComposerInsert?.(formatDiffComment(toLocation(file.path, commentRow), text))) {
                      setCommentRow(null);
                    }
                  }}
                  onCancel={() => setCommentRow(null)}
                  t={t}
                />
              )}
            </>
          : <p className="border-t border-border/60 px-2.5 py-1.5 text-muted-foreground">
              {file.binary
                ? t('workspace.changes.binary')
                : file.tooLarge
                  ? t('workspace.changes.tooLarge')
                  : t('workspace.changes.unavailable')}
            </p>
      )}
    </div>
  );
});

const lastTurnAppearance: Record<LastTurnFile['kind'], { label: string; className: string }> = {
  edit: { label: 'E', className: 'bg-muted text-muted-foreground' },
  write: { label: 'W', className: 'bg-diff-added text-diff-added-foreground' },
  delete: { label: 'D', className: 'bg-diff-removed text-diff-removed-foreground' },
  move: { label: 'M', className: 'bg-diff-added text-diff-added-foreground' },
};

const LastTurnChangeRow = memo(function LastTurnChangeRow({
  file,
  rowKey,
  openPath,
  onSetOpenPath,
  onOpenInEditor,
  onComposerInsert,
  t,
}: {
  file: LastTurnFile;
  rowKey: string;
  openPath: string | null;
  onSetOpenPath: (path: string | null) => void;
  onOpenInEditor: (path: string) => void;
  onComposerInsert?: (text: string) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [commentRow, setCommentRow] = useState<DiffCommentRow | null>(null);
  const expanded = openPath === rowKey;
  const canExpand = file.rows !== null || file.tooLarge;
  const onToggle = () => {
    if (canExpand) onSetOpenPath(expanded ? null : rowKey);
  };
  const appearance = lastTurnAppearance[file.kind];
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={onToggle} aria-expanded={canExpand ? expanded : undefined} disabled={!canExpand} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
          <span className={`rounded px-1 font-mono text-[10px] font-medium ${appearance.className}`}>{appearance.label}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
            {file.oldPath ? <>{file.oldPath} <span className="text-muted-foreground">{t('workspace.changes.renameArrow')}</span> {file.path}</> : file.path}
          </span>
        </button>
        <button type="button" onClick={() => onOpenInEditor(file.path)} title={t('workspace.changes.openInEditor')} aria-label={t('workspace.changes.openInEditor')} className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {expanded && file.rows !== null && (
        <>
          <UnifiedDiffRows rows={file.rows} onLineComment={onComposerInsert ? setCommentRow : undefined} />
          {commentRow && (
            <LineCommentBox
              key={commentRow.rowIndex}
              path={file.path}
              row={commentRow}
              onSubmit={(text) => {
                if (onComposerInsert?.(formatDiffComment(toLocation(file.path, commentRow), text))) {
                  setCommentRow(null);
                }
              }}
              onCancel={() => setCommentRow(null)}
              t={t}
            />
          )}
        </>
      )}
      {expanded && file.tooLarge && (
        <p className="border-t border-border/60 px-2.5 py-1.5 text-muted-foreground">{t('workspace.changes.tooLarge')}</p>
      )}
    </div>
  );
});


const COMMENT_MARKER = { added: '+', removed: '-', context: ' ' } as const;

function toLocation(path: string, row: DiffCommentRow) {
  return { path, oldLine: row.oldLine, newLine: row.newLine, marker: COMMENT_MARKER[row.kind], content: row.content };
}

/**
 * One line's comment: a path:line reference, an input, Enter to send. Sending
 * hands the formatted comment to the composer and closes; Escape closes
 * without sending. The draft is intentionally not kept across lines.
 */
export function LineCommentBox({
  path,
  row,
  onSubmit,
  onCancel,
  t,
}: {
  path: string;
  row: DiffCommentRow;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [draft, setDraft] = useState('');
  const line = diffCommentLine({
    marker: COMMENT_MARKER[row.kind],
    oldLine: row.oldLine,
    newLine: row.newLine,
  });
  const reference = line === null ? path : `${path}:${line}`;
  const send = () => {
    if (!draft.trim()) return;
    onSubmit(draft);
  };
  return (
    <div className="border-t border-border/60 px-2.5 py-1.5" data-line-comment={reference}>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{reference}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); send(); }
            if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          }}
          placeholder={t('workspace.changes.comment.placeholder')}
          aria-label={t('workspace.changes.comment.placeholder')}
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          aria-label={t('workspace.changes.comment.send')}
          className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
        >
          <span aria-hidden className="font-sans text-xs">↵</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('workspace.changes.comment.cancel')}
          className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <span aria-hidden className="font-sans text-xs">✕</span>
        </button>
      </div>
    </div>
  );
}
