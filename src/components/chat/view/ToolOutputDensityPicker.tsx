import { Rows2, Rows3, Rows4, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Pill, PillBar } from '../../../shared/view/ui';
import { TOOL_OUTPUT_DENSITIES } from '../utils/toolOutputDensity';
import type { ToolOutputDensity } from '../utils/toolOutputDensity';

/** Denser rows for the denser level, so the glyph reads the same way the transcript will. */
export const TOOL_OUTPUT_DENSITY_ICONS: Record<ToolOutputDensity, LucideIcon> = {
  compact: Rows4,
  balanced: Rows3,
  detailed: Rows2,
};

type ToolOutputDensityPickerProps = {
  value: ToolOutputDensity;
  onChange: (value: ToolOutputDensity) => void;
  ariaLabel: string;
  className?: string;
};

/**
 * The three-way segmented control for Settings. It is a radio group, not a
 * tab list: choosing a level changes a preference rather than which panel is
 * shown, and a screen reader should say "checked", not "selected".
 */
export default function ToolOutputDensityPicker({ value, onChange, ariaLabel, className }: ToolOutputDensityPickerProps) {
  const { t } = useTranslation('settings');

  return (
    <PillBar role="radiogroup" aria-label={ariaLabel} className={className}>
      {TOOL_OUTPUT_DENSITIES.map((level) => {
        const Icon = TOOL_OUTPUT_DENSITY_ICONS[level];
        const isActive = level === value;
        return (
          <Pill
            key={level}
            role="radio"
            isActive={isActive}
            ariaChecked={isActive}
            onClick={() => onChange(level)}
            className="px-2.5 py-1.5 text-xs"
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
            <span>{t(`preferences.toolOutputDensity.${level}`)}</span>
          </Pill>
        );
      })}
    </PillBar>
  );
}
