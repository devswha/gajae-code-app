import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { DEFAULT_PERMISSION_MODE, type PermissionModeUpdate, type ProjectPermissions } from '../../../hooks/useProjectPermissions';
import { cn } from '../../../utils/cn';
import {
  opensPermissionModePicker,
  PERMISSION_MODE_ICONS,
  PERMISSION_MODES,
  permissionModeShortcutLabel,
  type PermissionMode,
} from '../utils/permissionMode';

type PermissionModePickerProps = {
  permissions: ProjectPermissions | null;
  onSelectMode: (update: PermissionModeUpdate) => Promise<unknown> | unknown;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * The composer control for what the agent may do without asking.
 *
 * Three modes, per project, stored on the server so the next run reads the same
 * policy from any device. `bypass` is the default, matching the GJC CLI, and
 * like every mode it is one click away.
 */
export default function PermissionModePicker({ permissions, onSelectMode, busy = false, disabled = false, className }: PermissionModePickerProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = permissions?.projectId;
  const selectionOwner = useRef<object | null>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0 });

  const mode: PermissionMode = permissions?.mode ?? DEFAULT_PERMISSION_MODE;
  const Icon = PERMISSION_MODE_ICONS[mode];
  const unavailable = disabled || !permissions;
  const isBusy = busy || selecting;
  const shortcut = permissionModeShortcutLabel();

  useEffect(() => {
    selectionOwner.current = {};
    setOpen(false);
    setError(null);
    setSelecting(false);
    return () => { selectionOwner.current = null; };
  }, [projectId]);

  useEffect(() => {
    if (unavailable || isBusy) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !opensPermissionModePicker(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [unavailable, isBusy]);

  // Same body portal as the model and preset pickers: the composer clips its
  // children, so the popup is positioned above the trigger in viewport space.
  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPopupPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 320 - 8)),
      });
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const apply = async (update: PermissionModeUpdate) => {
    if (unavailable || isBusy) return;
    const owner = selectionOwner.current;
    setSelecting(true);
    setError(null);
    try {
      await onSelectMode(update);
    } catch (failure) {
      if (selectionOwner.current === owner) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (selectionOwner.current === owner) setSelecting(false);
    }
  };

  const choose = async (next: PermissionMode) => {
    if (unavailable || isBusy) return;
    setOpen(false);
    if (next === mode) return;
    await apply({ mode: next });
  };

  const label = t(`permissionMode.modes.${mode}.label`);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={unavailable || isBusy}
        data-mode={mode}
        className="flex h-8 w-full max-w-40 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        aria-label={t('permissionMode.label')}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={t('permissionMode.tooltip', { mode: label, shortcut })}
      >
        {isBusy ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : <Icon className="size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && !unavailable && !isBusy && createPortal(
        <div
          ref={popupRef}
          role="listbox"
          aria-label={t('permissionMode.label')}
          className="fixed z-80 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, left: popupPosition.left }}
        >
          <div className="px-2.5 pt-1 pb-1.5">
            <p className="text-xs font-semibold">{t('permissionMode.title')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('permissionMode.description')}</p>
          </div>
          {PERMISSION_MODES.map((option) => {
            const OptionIcon = PERMISSION_MODE_ICONS[option];
            const isSelected = option === mode;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-mode={option}
                onClick={() => { void choose(option); }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent',
                  isSelected && 'bg-accent/70',
                )}
              >
                <OptionIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{t(`permissionMode.modes.${option}.label`)}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {t(`permissionMode.modes.${option}.description`)}
                  </span>
                </span>
                {isSelected && <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
              </button>
            );
          })}
          {permissions && permissions.allowAlways.length > 0 && (
            <p className="border-t border-border/60 px-2.5 pt-2 pb-1 text-[11px] text-muted-foreground">
              {t('permissionMode.alwaysAllowedSummary', { count: permissions.allowAlways.length, tools: permissions.allowAlways.join(', ') })}
            </p>
          )}
        </div>,
        document.body,
      )}

      {error && <p role="alert" className="mt-1 max-w-80 text-xs text-destructive">{error}</p>}
    </div>
  );
}
