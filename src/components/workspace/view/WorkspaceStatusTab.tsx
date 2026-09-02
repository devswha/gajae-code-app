import { GitBranch, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTokens, type SessionStatusSnapshot } from '../../../contexts/sessionStatusSnapshot';
import type { PermissionMode } from '../../../hooks/useProjectPermissions';
import { PERMISSION_MODE_ICONS } from '../../chat/utils/permissionMode';
import { reasoningEffortLabel } from '../../chat/view/reasoningEffort';
import { useProjectGitSummary } from '../hooks/useProjectGitSummary';

export type WorkspaceStatusTabProps = {
  status: SessionStatusSnapshot;
  projectName?: string;
  projectPath?: string;
  projectId?: string;
  /** The project's permission mode; null while it is still loading. */
  permissionMode?: PermissionMode | null;
  /** The Status tab is the visible one; git is only read while it is. */
  active: boolean;
};

/**
 * Read-only answer to "what is this session actually doing, and where".
 *
 * Every value here is something the runtime or git reported. A field the
 * runtime has not sent renders as unreported rather than as a zero, because a
 * fabricated zero is worse than an honest gap.
 */
export default function WorkspaceStatusTab({
  status,
  projectName,
  projectPath,
  projectId,
  permissionMode = null,
  active,
}: WorkspaceStatusTabProps) {
  const { t } = useTranslation();
  const { t: tChat } = useTranslation('chat');
  const { state: gitState, refresh: refreshGit } = useProjectGitSummary(projectId, active);

  const unreported = <span className="text-muted-foreground/70">{t('workspace.statusTab.unreported')}</span>;
  const PermissionIcon = permissionMode ? PERMISSION_MODE_ICONS[permissionMode] : null;

  return (
    <div className="h-full overflow-y-auto px-3 py-3 text-xs">
      {status.sessionId ? (
        <>
          <Section title={t('workspace.statusTab.session')}>
            <Row label={t('workspace.statusTab.model')}>
              {status.modelId ? <span className="font-medium text-foreground">{status.modelId}</span> : unreported}
            </Row>
            <Row label={t('workspace.statusTab.reasoning')}>
              {reasoningEffortLabel(status.thinkingLevel) ?? unreported}
            </Row>
            <ContextRow
              status={status}
              label={t('workspace.statusTab.context')}
              windowLabel={t('workspace.statusTab.contextWindow')}
              fallback={unreported}
            />
          </Section>

          <Section title={t('workspace.statusTab.activity')}>
            <Row label={t('workspace.statusTab.activity')}>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${status.activity.running ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'}`}
                />
                {status.activity.statusText
                  ?? (status.activity.running ? t('workspace.statusTab.running') : t('workspace.statusTab.idle'))}
              </span>
            </Row>
            {status.activity.queued > 0 && (
              <Row label={t('workspace.statusTab.queuedMessage')}>{status.activity.queued}</Row>
            )}
          </Section>

          {status.tokens && (
            <Section title={t('workspace.statusTab.tokens')}>
              <Row label={t('workspace.statusTab.tokensUsed')}>
                <span className="font-medium text-foreground">{formatTokens(status.tokens.used)}</span>
              </Row>
              {status.tokens.input !== undefined && (
                <Row label={t('workspace.statusTab.tokensInput')}>{formatTokens(status.tokens.input)}</Row>
              )}
              {status.tokens.output !== undefined && (
                <Row label={t('workspace.statusTab.tokensOutput')}>{formatTokens(status.tokens.output)}</Row>
              )}
              {status.tokens.cache !== undefined && (
                <Row label={t('workspace.statusTab.tokensCache')}>{formatTokens(status.tokens.cache)}</Row>
              )}
            </Section>
          )}
        </>
      ) : (
        <div className="mb-4 rounded-md border border-dashed border-border/70 px-3 py-4 text-center">
          <p className="font-medium text-foreground">{t('workspace.statusTab.empty')}</p>
          <p className="mt-0.5 text-muted-foreground">{t('workspace.statusTab.emptyHint')}</p>
        </div>
      )}

      <Section title={t('workspace.statusTab.location')}>
        <Row label={t('workspace.statusTab.project')}>{projectName ?? unreported}</Row>
        <Row label={t('workspace.statusTab.directory')}>
          <span className="font-mono text-[11px] break-all" title={status.cwd ?? projectPath}>
            {status.cwd ?? projectPath ?? unreported}
          </span>
        </Row>
        <Row label={t('workspace.statusTab.permissions')}>
          {permissionMode && PermissionIcon ? (
            <span
              data-permission-mode={permissionMode}
              className={`inline-flex items-center gap-1.5 font-medium ${permissionMode === 'bypass' ? 'text-destructive' : 'text-foreground'}`}
            >
              <PermissionIcon className="h-3 w-3" aria-hidden />
              {tChat(`permissionMode.modes.${permissionMode}.label`)}
            </span>
          ) : unreported}
        </Row>
      </Section>

      <Section
        title={t('workspace.statusTab.git')}
        action={(
          <button
            type="button"
            onClick={() => { void refreshGit(); }}
            title={t('workspace.statusTab.refreshGit')}
            aria-label={t('workspace.statusTab.refreshGit')}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${gitState.kind === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        )}
      >
        {gitState.kind === 'ready' ? (
          <>
            <Row label={t('workspace.statusTab.branch')}>
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <GitBranch className="h-3 w-3 text-muted-foreground" aria-hidden />
                {gitState.summary.branch ?? unreported}
              </span>
            </Row>
            {gitState.summary.changed + gitState.summary.staged + gitState.summary.untracked === 0 ? (
              <Row label={t('workspace.statusTab.changes')}>{t('workspace.statusTab.clean')}</Row>
            ) : (
              <>
                <Row label={t('workspace.statusTab.changes')}>{gitState.summary.changed}</Row>
                <Row label={t('workspace.statusTab.staged')}>{gitState.summary.staged}</Row>
                <Row label={t('workspace.statusTab.untracked')}>{gitState.summary.untracked}</Row>
              </>
            )}
          </>
        ) : (
          <p className="py-1 text-muted-foreground">
            {gitState.kind === 'not-a-repository' && t('workspace.statusTab.notARepository')}
            {gitState.kind === 'unavailable' && t('workspace.statusTab.gitUnavailable')}
            {(gitState.kind === 'loading' || gitState.kind === 'idle') && t('workspace.statusTab.unreported')}
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">{title}</h3>
        {action}
      </div>
      <div className="rounded-md border border-border/60 px-2.5 py-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-foreground">{children}</span>
    </div>
  );
}

function ContextRow({
  status,
  label,
  windowLabel,
  fallback,
}: {
  status: SessionStatusSnapshot;
  label: string;
  windowLabel: string;
  fallback: ReactNode;
}) {
  const { contextPercent, contextWindow, contextTokens } = status;

  if (contextPercent === undefined && contextTokens === undefined) {
    return <Row label={label}>{fallback}</Row>;
  }

  return (
    <>
      <Row label={label}>
        <span className="font-medium text-foreground">
          {contextTokens !== undefined ? formatTokens(contextTokens) : fallback}
          {contextPercent !== undefined && <span className="ml-1 text-muted-foreground">({Math.round(contextPercent)}%)</span>}
        </span>
      </Row>
      {contextPercent !== undefined && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(contextPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mb-1 h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={`h-full rounded-full ${contextPercent >= 85 ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${Math.max(2, Math.round(contextPercent))}%` }}
          />
        </div>
      )}
      {contextWindow !== undefined && (
        <Row label={windowLabel}>{formatTokens(contextWindow)}</Row>
      )}
    </>
  );
}
