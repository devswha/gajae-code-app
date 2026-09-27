import { CircleAlert, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TOAST_DURATION_MS, useToastStore, type Toast } from '../../../stores/useToastStore';
import { cn } from '../../../utils/cn';

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation('common');
  const dismiss = useToastStore((state) => state.dismiss);
  // Hovering or focusing a notice holds it: it must not vanish while it is
  // being read or while the pointer is on its close button.
  const [held, setHeld] = useState(false);
  const remaining = useRef(TOAST_DURATION_MS[toast.tone]);

  useEffect(() => {
    if (held) return undefined;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - startedAt));
    };
  }, [held, dismiss, toast.id]);

  const Icon = toast.tone === 'error' ? CircleAlert : Info;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      data-toast-tone={toast.tone}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border border-border bg-popover py-2.5 pr-2 pl-3 text-sm text-popover-foreground shadow-lg"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', toast.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
      <p className="min-w-0 flex-1 wrap-break-word">{toast.message}</p>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label={t('toasts.dismiss')}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The window's one place for transient notices: top centre, clear of the
 * composer and both side panels, above dialogs. Mounted once at the root.
 */
export function Toaster() {
  const { t } = useTranslation('common');
  const toasts = useToastStore((state) => state.toasts);

  return (
    <section
      aria-label={t('toasts.region')}
      className="pointer-events-none fixed top-3 left-1/2 z-10000 flex w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} />)}
    </section>
  );
}
