import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import { useProjectChanges, type ProjectChange } from '../hooks/useProjectChanges';

import UnifiedDiff from './UnifiedDiff';

export type WorkspaceChangesTabProps = {
  projectId?: string;
  projectPath?: string;
  projectName?: string;
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
  active,
}: WorkspaceChangesTabProps) {
  const { t } = useTranslation();
  const { state, refresh } = useProjectChanges(projectId, active);
  const [openPath, setOpenPath] = useState<string | null>(null);

  const openInEditor = (path: string) => {
    if (!projectPath) {
      return;
    }
    const absolutePath = path.startsWith('/') ? path : `${projectPath.replace(/\/$/, '')}/${path}`;
    void api.system.openFile(absolutePath);
  };

  return (
    <div className="h-full overflow-y-auto px-3 py-3 text-xs">
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
            {t('workspace.changes.title')}
          </h3>
          <button
            type="button"
            onClick={() => { void refresh(); }}
            title={t('workspace.changes.refreshLabel')}
            aria-label={t('workspace.changes.refreshLabel')}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${state.kind === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="rounded-md border border-border/60">
          {state.kind === 'ready' ? (
            <>
              <div className="truncate border-b border-border/60 px-2.5 py-1.5 text-muted-foreground">
                {state.changes.branch ?? projectName ?? '—'} · {t('workspace.changes.files', { count: state.changes.files.length })}
              </div>
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
                    expanded={openPath === file.path}
                    onToggle={() => setOpenPath((current) => current === file.path ? null : file.path)}
                    onOpenInEditor={() => openInEditor(file.path)}
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

export function ChangeRow({
  file,
  expanded,
  onToggle,
  onOpenInEditor,
  t,
}: {
  file: ProjectChange;
  expanded: boolean;
  onToggle: () => void;
  onOpenInEditor: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
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
          onClick={onOpenInEditor}
          title={t('workspace.changes.openInEditor')}
          aria-label={t('workspace.changes.openInEditor')}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        file.patch !== null
          ? <UnifiedDiff patch={file.patch} />
          : <p className="border-t border-border/60 px-2.5 py-1.5 text-muted-foreground">{file.binary ? t('workspace.changes.binary') : t('workspace.changes.tooLarge')}</p>
      )}
    </div>
  );
}
