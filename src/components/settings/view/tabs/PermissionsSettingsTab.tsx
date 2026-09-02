import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { useConfiguredProjectPermissions, type ProjectPermissions } from '../../../../hooks/useProjectPermissions';
import { useProjectsQuery } from '../../../../hooks/useProjectsQuery';
import { Button } from '../../../../shared/view/ui';
import { PERMISSION_MODE_ICONS } from '../../../chat/utils/permissionMode';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

type ProjectRowProps = {
  entry: ProjectPermissions;
  displayName: string;
  onRevoke: (toolName: string) => void;
  onReset: () => void;
};

function ProjectPermissionsRow({ entry, displayName, onRevoke, onReset }: ProjectRowProps) {
  const { t } = useTranslation('settings');
  const { t: tChat } = useTranslation('chat');
  const ModeIcon = PERMISSION_MODE_ICONS[entry.mode];
  const isBypass = entry.mode === 'bypass';

  return (
    <div className="space-y-3 px-4 py-4" data-project-id={entry.projectId}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={entry.projectPath}>{entry.projectPath}</div>
        </div>
        <Button variant="outline" size="sm" onClick={onReset} className="shrink-0">
          {t('permissions.resetToAsk')}
        </Button>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('permissions.mode')}</dt>
        <dd className={`inline-flex items-center gap-1.5 font-medium ${isBypass ? 'text-destructive' : 'text-foreground'}`} data-mode={entry.mode}>
          <ModeIcon className="size-3.5" aria-hidden />
          {tChat(`permissionMode.modes.${entry.mode}.label`)}
        </dd>
        <dt className="text-muted-foreground">{t('permissions.alwaysAllowed')}</dt>
        <dd>
          {entry.allowAlways.length === 0 ? (
            <span className="text-muted-foreground">{t('permissions.none')}</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {entry.allowAlways.map((toolName) => (
                <li key={toolName} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                  {toolName}
                  <button
                    type="button"
                    onClick={() => onRevoke(toolName)}
                    aria-label={t('permissions.revokeTool', { tool: toolName })}
                    title={t('permissions.revoke')}
                    className="rounded-sm text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </div>
  );
}

/**
 * Every project whose permission policy is not the default, with the two
 * ways back: revoke one always-allowed tool, or reset the whole project to Ask.
 * Projects on the default are not listed, so an empty list is the safe state.
 */
export default function PermissionsSettingsTab() {
  const { t } = useTranslation('settings');
  const { projects: configured, isLoading, error, revokeAlwaysAllow, reset } = useConfiguredProjectPermissions();
  const { data: projects } = useProjectsQuery();
  const nameOf = (entry: ProjectPermissions) =>
    projects?.find((project) => project.projectId === entry.projectId)?.displayName
    ?? entry.projectPath.split(/[\\/]/).filter(Boolean).pop()
    ?? entry.projectPath;

  return (
    <div className="space-y-8">
      <SettingsSection title={t('permissions.title')} description={t('permissions.description')}>
        <SettingsCard divided>
          {isLoading && <p className="px-4 py-4 text-sm text-muted-foreground">{t('permissions.loading')}</p>}
          {!isLoading && error && <p className="px-4 py-4 text-sm text-destructive" role="alert">{t('permissions.error')}</p>}
          {!isLoading && !error && configured.length === 0 && (
            <p className="px-4 py-4 text-sm text-muted-foreground">{t('permissions.empty')}</p>
          )}
          {configured.map((entry) => (
            <ProjectPermissionsRow
              key={entry.projectId}
              entry={entry}
              displayName={nameOf(entry)}
              onRevoke={(toolName) => { void revokeAlwaysAllow({ projectId: entry.projectId, toolName }).catch(() => {}); }}
              onReset={() => { void reset(entry.projectId).catch(() => {}); }}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
