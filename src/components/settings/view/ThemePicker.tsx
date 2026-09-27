import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../../../contexts/ThemeContext';
import { Pill, PillBar } from '../../../shared/view/ui';

const THEME_ICONS: Record<ThemePreference, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

/**
 * System / Light / Dark, the way the OS offers it. A light-dark switch had no
 * way back to following the system once flipped.
 */
export default function ThemePicker() {
  const { t } = useTranslation('settings');
  const { preference, setPreference } = useTheme();

  return (
    <PillBar role="radiogroup" aria-label={t('appearanceSettings.theme.label')}>
      {THEME_PREFERENCES.map((option) => {
        const Icon = THEME_ICONS[option];
        const isActive = option === preference;
        return (
          <Pill
            key={option}
            role="radio"
            isActive={isActive}
            ariaChecked={isActive}
            onClick={() => setPreference(option)}
            className="px-2.5 py-1.5 text-xs"
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
            <span>{t(`appearanceSettings.theme.${option}`)}</span>
          </Pill>
        );
      })}
    </PillBar>
  );
}
