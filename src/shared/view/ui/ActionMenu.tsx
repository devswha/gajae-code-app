import * as React from 'react';
import { ChevronDown, Loader2, type LucideIcon } from 'lucide-react';

import { cn } from '../../../utils/cn';

import { Button } from './Button';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export type ActionMenuItem = { key: string; label: string; description?: string; icon?: LucideIcon; onSelect: () => void; disabled?: boolean; loading?: boolean; isDanger?: boolean; showDividerBefore?: boolean; };

type ActionMenuProps = { label: string; items: ActionMenuItem[]; icon?: LucideIcon; ariaLabel?: string; align?: 'left' | 'right'; variant?: ButtonVariant; size?: ButtonSize; className?: string; triggerClassName?: string; disabled?: boolean; };

function MenuItems({ items, onChoose }: { items: ActionMenuItem[]; onChoose: (item: ActionMenuItem) => void; }) {
  return items.map((item) => {
    const ItemIcon = item.icon;
    const unavailable = item.disabled || item.loading;
    return (
      <React.Fragment key={item.key}>
        {item.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
        <button
          type="button"
          role="menuitem"
          disabled={unavailable}
          onClick={() => onChoose(item)}
          className={cn(
            'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
            'focus:bg-accent focus:outline-hidden',
            unavailable ? 'cursor-not-allowed opacity-50' : item.isDanger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-accent',
          )}
        >
          {item.loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : ItemIcon && <ItemIcon className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="block leading-5 font-medium">{item.label}</span>
            {item.description && <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{item.description}</span>}
          </span>
        </button>
      </React.Fragment>
    );
  });
}

function useActionMenu() {
  const [open, setOpen] = React.useState(false);
  const container = React.useRef<HTMLDivElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const popup = React.useRef<HTMLDivElement | null>(null);
  const returnFocus = React.useRef(false);
  const hadPopup = React.useRef(false);
  const popupId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const closeForPointer = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      returnFocus.current = true;
      setOpen(false);
    };
    document.addEventListener('mousedown', closeForPointer);
    document.addEventListener('keydown', closeForEscape);
    return () => {
      document.removeEventListener('mousedown', closeForPointer);
      document.removeEventListener('keydown', closeForEscape);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) {
      hadPopup.current = true;
      const firstAvailable = popup.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
      (firstAvailable ?? popup.current)?.focus();
      return;
    }
    if (!hadPopup.current) return;
    hadPopup.current = false;
    if (returnFocus.current) trigger.current?.focus();
    returnFocus.current = false;
  }, [open]);

  const choose = (item: ActionMenuItem) => {
    if (item.disabled || item.loading) return;
    returnFocus.current = true;
    setOpen(false);
    item.onSelect();
  };

  return { open, setOpen, container, trigger, popup, popupId, choose };
}

export default function ActionMenu({ label, items, icon: TriggerIcon, ariaLabel, align = 'right', variant = 'outline', size = 'sm', className, triggerClassName, disabled }: ActionMenuProps) {
  const menu = useActionMenu();
  return (
    <div ref={menu.container} className={cn('relative inline-flex', className)}>
      <Button
        ref={menu.trigger}
        type="button"
        variant={variant}
        size={size}
        className={triggerClassName}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.popupId : undefined}
        onClick={() => menu.setOpen((current) => !current)}
      >
        {TriggerIcon && <TriggerIcon className="h-4 w-4" />}
        {label && <span>{label}</span>}
        {label && <ChevronDown className={cn('h-4 w-4 transition-transform', menu.open && 'rotate-180')} />}
      </Button>
      {menu.open && (
        <div
          ref={menu.popup}
          id={menu.popupId}
          role="menu"
          tabIndex={-1}
          className={cn(
            'absolute top-full z-50 mt-2 min-w-55 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <MenuItems items={items} onChoose={menu.choose} />
        </div>
      )}
    </div>
  );
}
