import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { Tooltip } from '../../../shared/view/ui';
import { cyclesToolOutputDensity, nextToolOutputDensity } from '../utils/toolOutputDensity';

import { TOOL_OUTPUT_DENSITY_ICONS } from './ToolOutputDensityPicker';

const isApplePlatform = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

/** The chord as the keyboard in front of the user labels it. */
export const toolOutputDensityShortcutLabel = (): string => (isApplePlatform() ? '⌘⇧D' : 'Ctrl+Shift+D');

/**
 * One icon button in the chat header that walks compact -> balanced ->
 * detailed. The level is a reading preference that changes several times in a
 * session - folded while the agent works, open while checking what it did -
 * which is too often for a trip to Settings. The same chord (Cmd/Ctrl+Shift+D)
 * cycles it from the keyboard while the header is mounted.
 */
export default function ToolOutputDensityToggle({ className = '' }: { className?: string }) {
  const { t } = useTranslation('chat');
  const { preferences, setPreference } = useUiPreferences();
  const density = preferences.toolOutputDensity;
  const cycle = () => setPreference('toolOutputDensity', nextToolOutputDensity(density));

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !cyclesToolOutputDensity(event)) return;
      event.preventDefault();
      setPreference('toolOutputDensity', nextToolOutputDensity(density));
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [density, setPreference]);

  const Icon = TOOL_OUTPUT_DENSITY_ICONS[density];
  const label = t('toolOutputDensity.tooltip', {
    level: t(`toolOutputDensity.${density}`),
    shortcut: toolOutputDensityShortcutLabel(),
  });

  return (
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        onClick={cycle}
        aria-label={label}
        data-density={density}
        className={`shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground ${className}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </button>
    </Tooltip>
  );
}
