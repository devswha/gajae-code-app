import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ProviderModelOption } from '../../../../types/app';

type ModelPresetPickerProps = {
  value: string;
  options: ProviderModelOption[];
  loading?: boolean;
  onSelect: (value: string) => Promise<unknown> | unknown;
};

const ROLE_LABELS = {
  default: 'Default',
  planner: 'Planner',
  executor: 'Executor',
  architect: 'Architect',
  critic: 'Critic',
} as const;

function compactModelLabel(selector: string): string {
  const withoutProvider = selector.includes('/') ? selector.slice(selector.indexOf('/') + 1) : selector;
  return withoutProvider.replace(/:/, ' · ');
}

export default function ModelPresetPicker({ value, options, loading = false, onSelect }: ModelPresetPickerProps) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, right: 0 });
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPopupPosition({
        bottom: window.innerHeight - rect.top + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={loading || selecting || options.length === 0}
        className="flex h-8 max-w-40 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        aria-label="모델 프리셋 선택"
        aria-expanded={open}
      >
        {(loading || selecting) && <Loader2 className="size-3 animate-spin" />}
        <span className="truncate">{selected?.label ?? 'Current'}</span>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[80] w-[22rem] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, right: popupPosition.right }}
        >
          <div className="px-2 pb-2 pt-1">
            <p className="text-xs font-semibold">모델 프리셋</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">기본 에이전트와 4개 전문 에이전트 구성을 함께 선택합니다.</p>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    'w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-accent/70',
                  )}
                  onClick={async () => {
                    if (isSelected) {
                      setOpen(false);
                      return;
                    }
                    setSelecting(true);
                    try {
                      await onSelect(option.value);
                      setOpen(false);
                    } finally {
                      setSelecting(false);
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
                    {isSelected && <Check className="size-3.5 text-primary" />}
                  </div>
                  {option.roles && (
                    <div className="mt-1.5 grid grid-cols-[4.25rem_1fr] gap-x-2 gap-y-1">
                      {Object.entries(ROLE_LABELS).map(([role, label]) => {
                        const selector = option.roles?.[role as keyof typeof ROLE_LABELS];
                        if (!selector) return null;
                        return (
                          <div key={role} className="contents">
                            <span className="text-[10px] text-muted-foreground">{label}</span>
                            <span className="truncate text-[10px] text-foreground/80" title={selector}>{compactModelLabel(selector)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
