import { useState } from 'react';
import { Archive, ArrowLeft, Folder, RotateCcw, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { api } from '../../../utils/api';
import type { ArchivedProjectListItem, ArchivedSessionListItem } from '../types/types';

type ArchivedSessionGroup = {
  readonly key: string;
  readonly projectId: string | null;
  readonly projectDisplayName: string;
  readonly projectPath: string | null;
  readonly isProjectArchived: boolean;
  readonly sessions: ArchivedSessionListItem[];
  latestActivity: string | null;
};

type SidebarArchiveContentProps = {
  readonly archivedProjects: readonly ArchivedProjectListItem[];
  readonly archivedSessions: readonly ArchivedSessionListItem[];
  readonly archivedSessionsCount: number;
  readonly isArchivedSessionsLoading: boolean;
  readonly archiveLoadError: string | null;
  readonly onRetry: () => void;
  readonly onCloseArchive: () => void;
  readonly onRestoreArchivedProject: (projectId: string) => void;
  readonly onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  readonly onRestoreArchivedSession: (sessionId: string) => void;
  readonly onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  readonly t: TFunction;
};

function ArchiveBackButton({ onCloseArchive, t }: Pick<SidebarArchiveContentProps, 'onCloseArchive' | 't'>) {
  const closeArchiveLabel = t('archived.closeArchive', 'Back to projects');

  return (
    <button
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onCloseArchive}
      aria-label={closeArchiveLabel}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {closeArchiveLabel}
    </button>
  );
}

function groupArchivedSessionsByProject(sessions: readonly ArchivedSessionListItem[]): ArchivedSessionGroup[] {
  const groups = new Map<string, ArchivedSessionGroup>();

  for (const session of sessions) {
    const key = session.projectId ?? session.projectPath ?? `session:${session.sessionId}`;
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      if (!existingGroup.latestActivity || (session.lastActivity && session.lastActivity > existingGroup.latestActivity)) {
        existingGroup.latestActivity = session.lastActivity;
      }
      continue;
    }

    groups.set(key, {
      key,
      projectId: session.projectId,
      projectDisplayName: session.projectDisplayName,
      projectPath: session.projectPath,
      isProjectArchived: session.isProjectArchived,
      sessions: [session],
      latestActivity: session.lastActivity,
    });
  }

  return [...groups.values()].sort((groupA, groupB) => {
    const a = groupA.latestActivity ?? '';
    const b = groupB.latestActivity ?? '';
    return b.localeCompare(a);
  });
}

function formatCompactArchivedAge(dateString: string | null): string {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  return `${Math.floor(diffInHours / 24)}d`;
}

/**
 * Bulk-archives sessions idle past a retention window.
 *
 * Sessions accumulate with nothing to clear them, and archiving one at a time
 * is not a way to deal with hundreds. Preview is mandatory: the count is
 * fetched first and the commit button only appears once it is known, so the
 * action always states its own size before it runs. Both calls run the same
 * server-side selection, so the number shown is the number acted on.
 *
 * Archive only — nothing leaves the disk, and every result stays restorable
 * from this same screen.
 */
function ArchiveIdleSessionsControl({ onArchived, t }: { onArchived: () => void; t: TFunction }) {
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.archiveIdleSessions(days, dryRun);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json())?.data ?? {};
      if (dryRun) {
        setPreview(Number(data.matched ?? 0));
      } else {
        setPreview(null);
        onArchived();
      }
    } catch {
      setError(t('archived.bulkFailed', 'Could not archive idle sessions.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-1 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t('archived.bulkLabel', 'Archive sessions idle for')}
        </span>
        <select
          value={days}
          disabled={busy}
          onChange={(event) => { setDays(Number(event.target.value)); setPreview(null); }}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
          aria-label={t('archived.bulkLabel', 'Archive sessions idle for')}
        >
          {[7, 30, 60, 90].map((option) => (
            <option key={option} value={option}>
              {t('archived.bulkDays', '{{count}} days', { count: option })}
            </option>
          ))}
        </select>
        {preview === null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t('archived.bulkPreview', 'Check')}
          </button>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

      {preview !== null && !error && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 text-xs text-foreground/80">
            {preview === 0
              ? t('archived.bulkNone', 'Nothing that old.')
              : t('archived.bulkFound', '{{count}} to archive', { count: preview })}
          </span>
          {preview > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(false)}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t('archived.bulkConfirm', 'Archive')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setPreview(null)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t('archived.bulkCancel', 'Cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SidebarArchiveContent({
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  archiveLoadError,
  onRetry,
  onCloseArchive,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  t,
}: SidebarArchiveContentProps) {
  const groupedArchivedSessions = groupArchivedSessionsByProject(archivedSessions);

  if (isArchivedSessionsLoading) {
    return (
      <div className="px-4 py-12 md:py-8">
        <ArchiveBackButton onCloseArchive={onCloseArchive} t={t} />
        <div className="pt-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
          <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
            {t('archived.loadingTitle', 'Loading archive...')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('archived.loadingDescription', 'Fetching hidden workspaces and sessions you can restore later.')}
          </p>
        </div>
      </div>
    );
  }

  if (archiveLoadError) {
    return (
      <div className="px-4 py-12 md:py-8">
        <ArchiveBackButton onCloseArchive={onCloseArchive} t={t} />
        <div className="pt-8 text-center">
          <p role="alert" className="text-sm text-destructive">{archiveLoadError}</p>
          <button
            className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            onClick={onRetry}
          >
            {t('archived.retryLoad', 'Retry')}
          </button>
        </div>
      </div>
    );
  }

  if (archivedProjects.length === 0 && groupedArchivedSessions.length === 0) {
    return (
      <div className="px-4 py-12 md:py-8">
        <ArchiveBackButton onCloseArchive={onCloseArchive} t={t} />
        <div className="pt-3">
          <ArchiveIdleSessionsControl onArchived={onRetry} t={t} />
        </div>
        <div className="pt-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
            <Archive className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
            {t('archived.emptyTitle', 'No archived items')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('archived.emptyDescription', 'Archived workspaces and sessions will appear here when you hide them from the active list.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2">
      <ArchiveBackButton onCloseArchive={onCloseArchive} t={t} />
      <ArchiveIdleSessionsControl onArchived={onRetry} t={t} />
      <p className="px-1 text-xs text-muted-foreground">
        {`${archivedSessionsCount} ${t(
          archivedSessionsCount === 1 ? 'archived.sessionCountOne' : 'archived.sessionCountOther',
          archivedSessionsCount === 1 ? 'archived item' : 'archived items',
        )}`}
      </p>
      {archivedProjects.map((project) => (
        <div key={project.projectId} className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-xs">
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-normal text-foreground">{project.displayName}</span>
                <span className="inline-flex items-center justify-center rounded-full bg-muted px-1 py-px text-center text-[7px] leading-none font-medium tracking-[0.02em] text-muted-foreground uppercase">
                  {t('archived.projectArchived', 'Project archived')}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground/70" title={project.fullPath}>{project.fullPath}</p>
            </div>
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors hover:bg-primary/20"
              onClick={() => onRestoreArchivedProject(project.projectId)}
              aria-label={t('archived.restoreProject', 'Restore workspace')}
              title={t('archived.restoreProject', 'Restore workspace')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      {groupedArchivedSessions.map((group) => (
        <div key={group.key} className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-xs">
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-normal text-foreground">{group.projectDisplayName}</span>
                {group.isProjectArchived && (
                  <span className="inline-flex items-center justify-center rounded-full bg-muted px-1 py-px text-center text-[7px] leading-none font-medium tracking-[0.02em] text-muted-foreground uppercase">
                    {t('archived.projectArchived', 'Project archived')}
                  </span>
                )}
              </div>
              {group.projectPath && <p className="mt-1 truncate text-xs text-muted-foreground/70" title={group.projectPath}>{group.projectPath}</p>}
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">{group.sessions.length}</span>
          </div>
          <div className="divide-y divide-border/50">
            {group.sessions.map((session) => (
              <div key={session.sessionId} className="flex items-center gap-2 px-3 py-2.5">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground" onClick={() => onArchivedSessionClick(session)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-normal text-foreground">{session.sessionTitle}</span>
                      {session.lastActivity && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatCompactArchivedAge(session.lastActivity)}</span>}
                    </div>
                    <p className="mt-0.5 text-[11px] tracking-wide text-muted-foreground/70 uppercase">{session.provider}</p>
                  </div>
                </button>
                <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors hover:bg-primary/20" onClick={() => onRestoreArchivedSession(session.sessionId)} aria-label={t('archived.restore', 'Restore session')} title={t('archived.restore', 'Restore session')}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20" onClick={() => onDeleteArchivedSession(session)} aria-label={t('archived.deletePermanently', 'Delete permanently')} title={t('archived.deletePermanently', 'Delete permanently')}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
