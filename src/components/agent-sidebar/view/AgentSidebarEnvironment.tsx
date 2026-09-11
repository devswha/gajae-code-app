import { FileDiff, Folder, GitBranch, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStatus } from '../../../contexts/SessionStatusContext';
import { useProjectGitSummary } from '../../workspace/hooks/useProjectGitSummary';

export type AgentSidebarEnvironmentProps = {
  projectId?: string;
  /** Where the session runs: its worktree when it has one, else the project. */
  projectPath?: string;
  sessionId?: string;
};

/**
 * The compact "where am I" block at the top of the Agent sidebar: the
 * working-tree change count, the directory the agent runs in, and the branch.
 *
 * Every value is read from a source the app already trusts: git through the
 * same summary hook the Workspace Status tab uses, the directory from the
 * runtime's status snapshot (falling back to the caller's execution path).
 * Nothing is stored here and nothing is derived by guessing: a directory that
 * is not a repository says so, and a row whose fact is unknown is omitted
 * rather than filled with a zero or a default branch name.
 *
 * The rows are reports, not controls. The one action is the summary's
 * existing refresh, since a rail that stays open has no other way to notice
 * the agent changing files.
 */
export default function AgentSidebarEnvironment({ projectId, projectPath, sessionId }: AgentSidebarEnvironmentProps) {
  const { t } = useTranslation();
  const status = useSessionStatus();
  const { state: git, refresh } = useProjectGitSummary(projectId, Boolean(projectId), sessionId, projectPath);

  const directory = status.cwd ?? projectPath;

  return (
    <section aria-labelledby="agent-sidebar-environment" className="px-1 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <h3 id="agent-sidebar-environment" className="text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
          {t('agentSidebar.environment.title')}
        </h3>
        {projectId && (
          <button
            type="button"
            onClick={() => { void refresh(); }}
            title={t('agentSidebar.environment.refresh')}
            aria-label={t('agentSidebar.environment.refresh')}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${git.kind === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {git.kind === 'ready' && (
        // Every file the Changes tab would list: tracked changes (staged or
        // not; a path is counted once) plus untracked files.
        <Row icon={FileDiff} value={git.summary.changed + git.summary.untracked}>
          {t('agentSidebar.environment.changes')}
        </Row>
      )}
      {directory && (
        <Row icon={Folder} title={directory}>
          <span className="sr-only">{t('agentSidebar.environment.directory')}: </span>
          {leafName(directory)}
        </Row>
      )}
      {git.kind === 'ready' && git.summary.branch && (
        <Row icon={GitBranch} title={git.summary.branch}>
          <span className="sr-only">{t('agentSidebar.environment.branch')}: </span>
          {git.summary.branch}
        </Row>
      )}
      {git.kind === 'not-a-repository' && (
        <p className="px-2 py-1.5 text-muted-foreground">{t('agentSidebar.environment.notARepository')}</p>
      )}
      {git.kind === 'unavailable' && (
        <p className="px-2 py-1.5 text-muted-foreground">{t('agentSidebar.environment.gitUnavailable')}</p>
      )}
    </section>
  );
}

/** The last path segment; a trailing slash does not make the name empty. */
function leafName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

function Row({ icon: Icon, title, value, children }: { icon: LucideIcon; title?: string; value?: number; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5" title={title}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground">{children}</span>
      {value !== undefined && <span className="shrink-0 text-muted-foreground tabular-nums">{value}</span>}
    </div>
  );
}
