import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type { SessionStore } from '../../../stores/useSessionStore';
import { useLastTurnChanges, type LastTurnFile } from '../hooks/useLastTurnChanges';
import { useProjectChanges, type ProjectChange } from '../hooks/useProjectChanges';
import { diffCommentLine, formatDiffReview, type DiffCommentLocation, type DiffReviewComment } from '../utils/diffComment';

import UnifiedDiff, { UnifiedDiffRows } from './UnifiedDiff';
import type { DiffCommentRow } from './UnifiedDiff';

export type WorkspaceChangesTabProps = {
  projectId?: string;
  projectPath?: string;
  projectName?: string;
  sessionId?: string;
  sessionStore: SessionStore;
  lastTurnRunning?: boolean;
  /** Appends the review to the chat composer as the next message's draft. */
  onComposerInsert?: (text: string) => boolean;
  active: boolean;
};

/** One line comment waiting in the review, keyed by scope, file row and diff row. */
export type PendingComment = DiffReviewComment & { key: string };

type CommentUpdate = (key: string, location: DiffCommentLocation, comment: string | null) => void;

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
  // The review outlives row expansion and the scope toggle: a comment made on
  // the last turn's rows still names a real path:line once the user is back
  // on the working tree, and sending is one action for all of them.
  const [review, setReview] = useState<PendingComment[]>([]);
  // Cmd+Enter adds a comment and sends in the same event, so sending must
  // see the list as it is now, not as it was at the last render.
  const reviewRef = useRef(review);
  const commitReview = useCallback((next: PendingComment[]) => {
    reviewRef.current = next;
    setReview(next);
  }, []);

  const openInEditor = useCallback((path: string) => {
    if (!projectPath) {
      return;
    }
    const absolutePath = path.startsWith('/') ? path : `${projectPath.replace(/\/$/, '')}/${path}`;
    void api.system.openFile(absolutePath);
  }, [projectPath]);

  const updateComment = useCallback<CommentUpdate>((key, location, comment) => {
    const current = reviewRef.current;
    if (comment === null) {
      commitReview(current.filter((entry) => entry.key !== key));
      return;
    }
    const next = { key, location, comment };
    commitReview(current.some((entry) => entry.key === key)
      ? current.map((entry) => (entry.key === key ? next : entry))
      : [...current, next]);
  }, [commitReview]);

  const sendReview = useCallback(() => {
    const current = reviewRef.current;
    if (current.length === 0) return false;
    if (!onComposerInsert?.(formatDiffReview(current))) return false;
    commitReview([]);
    return true;
  }, [commitReview, onComposerInsert]);

  const refresh = () => {
    if (scope === 'workingTree') {
      void refreshWorkingTree();
    } else {
      refreshLastTurn();
    }
  };

  const rowProps = { openPath, onSetOpenPath: setOpenPath, onOpenInEditor: openInEditor, onComposerInsert, review, onCommentChange: updateComment, onSendReview: sendReview, t };

  return (
    <div className="flex h-full flex-col text-xs">
      <section className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
                  {...rowProps}
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
                    {...rowProps}
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
      {review.length > 0 && (
        <ReviewFooter count={review.length} onSend={sendReview} onClear={() => commitReview([])} t={t} />
      )}
    </div>
  );
}

/**
 * The review's send bar: how many comments are waiting, one button to hand
 * them to the composer, one to drop them. Shown only while something waits.
 */
export function ReviewFooter({ count, onSend, onClear, t }: { count: number; onSend: () => void; onClear: () => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-background px-3 py-2" data-review-footer>
      <button
        type="button"
        onClick={onClear}
        className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {t('workspace.changes.review.clear')}
      </button>
      <button
        type="button"
        onClick={onSend}
        className="rounded bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t('workspace.changes.review.send', { count })}
      </button>
    </div>
  );
}

type RowSharedProps = {
  openPath: string | null;
  onSetOpenPath: (path: string | null) => void;
  onOpenInEditor: (path: string) => void;
  onComposerInsert?: (text: string) => boolean;
  review: readonly PendingComment[];
  onCommentChange: CommentUpdate;
  onSendReview: () => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const COMMENT_MARKER = { added: '+', removed: '-', context: ' ' } as const;

function toLocation(path: string, row: DiffCommentRow): DiffCommentLocation {
  return { path, oldLine: row.oldLine, newLine: row.newLine, marker: COMMENT_MARKER[row.kind], content: row.content };
}

/**
 * The comment state one expanded diff needs: which row is being edited and
 * what to render under each row (the editor, or the note a pending comment
 * leaves behind). `prefix` scopes this file's keys inside the tab's review.
 */
function useRowComments(prefix: string, path: string, shared: RowSharedProps) {
  const { review, onCommentChange, onSendReview, onComposerInsert, t } = shared;
  const [editing, setEditing] = useState<DiffCommentRow | null>(null);
  const keyOf = (rowIndex: number) => `${prefix}\u0000${rowIndex}`;
  const annotations = new Map<number, ReactNode>();
  for (const entry of review) {
    if (!entry.key.startsWith(`${prefix}\u0000`)) continue;
    const rowIndex = Number(entry.key.slice(prefix.length + 1));
    if (editing?.rowIndex === rowIndex) continue;
    annotations.set(rowIndex, (
      <PendingCommentNote
        comment={entry.comment}
        onEdit={() => setEditing({ rowIndex, oldLine: entry.location.oldLine, newLine: entry.location.newLine, kind: entry.location.marker === '+' ? 'added' : entry.location.marker === '-' ? 'removed' : 'context', content: entry.location.content })}
        onRemove={() => onCommentChange(entry.key, entry.location, null)}
        t={t}
      />
    ));
  }
  if (editing) {
    const key = keyOf(editing.rowIndex);
    annotations.set(editing.rowIndex, (
      <LineCommentBox
        key={key}
        path={path}
        row={editing}
        initial={review.find((entry) => entry.key === key)?.comment ?? ''}
        onSubmit={(text, sendNow) => {
          onCommentChange(key, toLocation(path, editing), text);
          setEditing(null);
          if (sendNow) onSendReview();
        }}
        onCancel={() => setEditing(null)}
        t={t}
      />
    ));
  }
  return { annotations, onLineComment: onComposerInsert ? setEditing : undefined };
}

export const ChangeRow = memo(function ChangeRow({ file, ...shared }: { file: ProjectChange } & RowSharedProps) {
  const { openPath, onSetOpenPath, onOpenInEditor, t } = shared;
  const { annotations, onLineComment } = useRowComments(`workingTree\u0000${file.path}`, file.path, shared);
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
          ? <UnifiedDiff patch={file.patch} onLineComment={onLineComment} annotations={annotations} />
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

const LastTurnChangeRow = memo(function LastTurnChangeRow({ file, rowKey, ...shared }: { file: LastTurnFile; rowKey: string } & RowSharedProps) {
  const { openPath, onSetOpenPath, onOpenInEditor, t } = shared;
  const { annotations, onLineComment } = useRowComments(`lastTurn\u0000${rowKey}`, file.path, shared);
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
        <UnifiedDiffRows rows={file.rows} onLineComment={onLineComment} annotations={annotations} />
      )}
      {expanded && file.tooLarge && (
        <p className="border-t border-border/60 px-2.5 py-1.5 text-muted-foreground">{t('workspace.changes.tooLarge')}</p>
      )}
    </div>
  );
});

/** What a pending comment looks like under its line until the review is sent. */
function PendingCommentNote({ comment, onEdit, onRemove, t }: { comment: string; onEdit: () => void; onRemove: () => void; t: (key: string) => string }) {
  return (
    <div className="flex items-start gap-1.5 border-y border-border/60 bg-background px-2.5 py-1 font-sans" data-pending-comment>
      <button
        type="button"
        onClick={onEdit}
        title={t('workspace.changes.comment.edit')}
        className="min-w-0 flex-1 rounded text-left whitespace-pre-wrap text-foreground hover:bg-muted/50"
      >
        {comment}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('workspace.changes.comment.remove')}
        title={t('workspace.changes.comment.remove')}
        className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}

/**
 * One line's comment: a path:line reference, an input, Enter to add it to the
 * review; Cmd/Ctrl+Enter adds it and sends the whole review at once. Escape
 * closes without changing the review. A draft is not kept across lines.
 */
export function LineCommentBox({
  path,
  row,
  initial = '',
  onSubmit,
  onCancel,
  t,
}: {
  path: string;
  row: DiffCommentRow;
  initial?: string;
  onSubmit: (text: string, sendNow: boolean) => void;
  onCancel: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [draft, setDraft] = useState(initial);
  const line = diffCommentLine({
    marker: COMMENT_MARKER[row.kind],
    oldLine: row.oldLine,
    newLine: row.newLine,
  });
  const reference = line === null ? path : `${path}:${line}`;
  const submit = (sendNow: boolean) => {
    if (!draft.trim()) return;
    onSubmit(draft, sendNow);
  };
  return (
    <div className="border-t border-border/60 px-2.5 py-1.5 font-sans" data-line-comment={reference}>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{reference}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); submit(event.metaKey || event.ctrlKey); }
            if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          }}
          placeholder={t('workspace.changes.comment.placeholder')}
          aria-label={t('workspace.changes.comment.placeholder')}
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none"
        />
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={!draft.trim()}
          aria-label={t('workspace.changes.comment.submit')}
          title={t('workspace.changes.comment.submit')}
          className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
        >
          <span aria-hidden className="text-xs">↵</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('workspace.changes.comment.cancel')}
          className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <span aria-hidden className="text-xs">✕</span>
        </button>
      </div>
    </div>
  );
}
