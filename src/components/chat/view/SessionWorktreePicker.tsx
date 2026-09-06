import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionLocation } from '../hooks/useSessionLocation';

type Props = {
  value: boolean;
  onChange: (enabled: boolean) => void;
  sessionId?: string | null;
  location?: SessionLocation;
  disabled?: boolean;
};

/** Select once, before session creation; existing sessions retain their location. */
export default function SessionWorktreePicker({ value, onChange, sessionId, location, disabled }: Props) {
  const { t } = useTranslation('chat');
  if (sessionId) {
    if (location?.mode !== 'worktree') return null;
    return (
      <span className="inline-flex min-h-8 max-w-52 items-center gap-1.5 px-2 text-xs text-muted-foreground" title={location.cwd ?? t('sessionWorktree.preparing')}>
        <GitBranch className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{location.cwd ? t('sessionWorktree.worktree') : t('sessionWorktree.preparing')}</span>
      </span>
    );
  }
  return (
    <label className="inline-flex min-h-11 max-w-52 items-center gap-1.5 text-xs text-muted-foreground sm:min-h-8">
      <GitBranch className="size-3.5 shrink-0" aria-hidden />
      <select
        aria-label={t('sessionWorktree.label')}
        value={value ? 'worktree' : 'project'}
        onChange={(event) => onChange(event.target.value === 'worktree')}
        disabled={disabled}
        className="min-h-11 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:min-h-8"
      >
        <option value="project">{t('sessionWorktree.project')}</option>
        <option value="worktree">{t('sessionWorktree.newWorktree')}</option>
      </select>
    </label>
  );
}
