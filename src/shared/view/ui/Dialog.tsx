import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../utils/cn';

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
};

const dialogContext = React.createContext<DialogContextValue | null>(null);
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useDialog() {
  const dialog = React.useContext(dialogContext);
  if (dialog === null) throw new Error('Dialog components must be used within <Dialog>');
  return dialog;
}

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({
  open: suppliedOpen,
  onOpenChange: reportOpenChange,
  defaultOpen = false,
  children,
}) => {
  const [storedOpen, setStoredOpen] = React.useState(defaultOpen);
  const opener = React.useRef<HTMLElement | null>(null) as React.MutableRefObject<HTMLElement | null>;
  const externallyManaged = suppliedOpen !== undefined;
  const open = externallyManaged ? suppliedOpen : storedOpen;
  const setOpen = React.useCallback((nextOpen: boolean) => {
    if (!externallyManaged) setStoredOpen(nextOpen);
    reportOpenChange?.(nextOpen);
  }, [externallyManaged, reportOpenChange]);
  const dialog = React.useMemo(() => ({ open, onOpenChange: setOpen, triggerRef: opener }), [open, setOpen]);

  return <dialogContext.Provider value={dialog}>{children}</dialogContext.Provider>;
};

function setForwardedRef<T>(ref: React.ForwardedRef<T>, element: T | null) {
  if (typeof ref === 'function') {
    ref(element);
  } else if (ref) {
    ref.current = element;
  }
}

const DialogTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  function DialogTrigger({ onClick, children, asChild, ...props }, ref) {
    const { onOpenChange, triggerRef } = useDialog();
    const registerTrigger = React.useCallback((element: HTMLElement | null) => {
      triggerRef.current = element;
      setForwardedRef(ref, element as HTMLButtonElement | null);
    }, [ref, triggerRef]);
    const openFromButton = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
      onOpenChange(true);
      onClick?.(event);
    }, [onClick, onOpenChange]);

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>;
      return React.cloneElement(child, {
        onClick: (event: React.MouseEvent<HTMLElement>) => {
          onOpenChange(true);
          child.props.onClick?.(event);
        },
        ref: registerTrigger,
      });
    }

    return <button ref={registerTrigger} type="button" onClick={openFromButton} {...props}>{children}</button>;
  }
);
DialogTrigger.displayName = 'DialogTrigger';

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  onEscapeKeyDown?: () => void;
  onPointerDownOutside?: () => void;
  wrapperClassName?: string;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { className, children, onEscapeKeyDown, onPointerDownOutside, wrapperClassName, ...props },
  ref
) {
  const { open, onOpenChange, triggerRef } = useDialog();
  const panel = React.useRef<HTMLDivElement | null>(null);
  const focusBeforeDialog = React.useRef<HTMLElement | null>(null);
  const bindPanel = React.useCallback((element: HTMLDivElement | null) => {
    panel.current = element;
    setForwardedRef(ref, element);
  }, [ref]);

  React.useEffect(() => {
    if (open) {
      focusBeforeDialog.current = document.activeElement as HTMLElement;
      return;
    }
    if (focusBeforeDialog.current) {
      (triggerRef.current || focusBeforeDialog.current).focus();
      focusBeforeDialog.current = null;
    }
  }, [open, triggerRef]);

  React.useEffect(() => {
    if (!open) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscapeKeyDown?.();
        onOpenChange(false);
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;

      const candidates = Array.from(panel.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (candidates.length === 0) return;

      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey, true);
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.body.style.overflow = bodyOverflow;
    };
  }, [onEscapeKeyDown, onOpenChange, open]);

  React.useEffect(() => {
    if (!open || !panel.current) return;
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(focusableSelector)?.focus());
  }, [open]);

  if (!open) return null;

  const dismissFromOverlay = () => {
    onPointerDownOutside?.();
    onOpenChange(false);
  };

  return createPortal(
    <div className={cn('fixed inset-0 z-50', wrapperClassName)}>
      <div
        className="fixed inset-0 animate-dialog-overlay-show bg-background/80 backdrop-blur-xs"
        onClick={dismissFromOverlay}
        aria-hidden
      />
      <div
        ref={bindPanel}
        role="dialog"
        aria-modal="true"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border bg-popover text-popover-foreground shadow-lg',
          'animate-dialog-content-show',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body
  );
});
DialogContent.displayName = 'DialogContent';

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function DialogTitle({ className, ...props }, ref) {
    return <h2 ref={ref} className={cn('sr-only', className)} {...props} />;
  }
);
DialogTitle.displayName = 'DialogTitle';

export { Dialog, DialogTrigger, DialogContent, DialogTitle, useDialog };
