import { Moon, Sun } from 'lucide-react';

import { useTheme } from '../../../contexts/ThemeContext';
import { cn } from '../../../utils/cn';

type DarkModeToggleProps = { checked?: boolean; onToggle?: (nextValue: boolean) => void; ariaLabel?: string };

function DarkModeToggle({
  checked,
  onToggle,
  ariaLabel = 'Toggle dark mode',
}: DarkModeToggleProps) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const managesItsOwnState = checked === undefined || onToggle === undefined;
  const enabled = managesItsOwnState ? isDarkMode : checked;

  const flip = managesItsOwnState
    ? toggleDarkMode
    : () => onToggle(!enabled);

  return (
    <button
      onClick={flip}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer touch-manipulation items-center rounded-full border-2 transition-colors duration-200',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden',
        enabled ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
    >
      <span className="sr-only">{ariaLabel}</span>
      <span
        className={cn(
          'flex h-5 w-5 transform items-center justify-center rounded-full shadow-xs transition-transform duration-200',
          enabled ? 'translate-x-[22px] bg-card' : 'translate-x-[2px] bg-muted-foreground/60',
        )}
      >
        {enabled ? (
          <Moon className="h-3 w-3 text-primary" />
        ) : (
          <Sun className="h-3 w-3 text-background" />
        )}
      </span>
    </button>
  );
}

export default DarkModeToggle;
