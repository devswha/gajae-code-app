import { cn } from '../../../utils/cn';

type SettingsToggleProps = { checked: boolean; onChange: (value: boolean) => void; ariaLabel: string; disabled?: boolean };

export default function SettingsToggle({ checked, onChange, ariaLabel, disabled }: SettingsToggleProps) {
  const trackClass = checked ? 'border-primary bg-primary' : ['border-border', 'bg-muted'].join(' ');
  const thumbClass = checked
    ? ['translate-x-[22px]', 'bg-white'].join(' ')
    : ['translate-x-[2px]', 'bg-foreground/60 dark:bg-foreground/80'].join(' ');
  const controlClass = [
    'relative inline-flex h-7 w-12 shrink-0',
    'cursor-pointer touch-manipulation items-center rounded-full border-2 transition-colors duration-200',
  ].join(' ');
  const focusClass = [
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'focus-visible:ring-offset-background focus-visible:outline-hidden',
  ].join(' ');
  const handleClass = [
    'pointer-events-none inline-block h-5 w-5 rounded-full shadow-xs',
    'transition-transform duration-200',
  ].join(' ');

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        controlClass,
        focusClass,
        trackClass,
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          handleClass,
          thumbClass,
        )}
      />
    </button>
  );
}
