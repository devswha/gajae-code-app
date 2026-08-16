import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type ReasoningEffort =
  | 'default'
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

type ReasoningEffortPickerProps = {
  value: ReasoningEffort;
  onSelect: (value: ReasoningEffort) => void;
};

const OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

export default function ReasoningEffortPicker({ value, onSelect }: ReasoningEffortPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0 });
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  // The composer form clips its children (overflow-hidden rounded corners), so
  // the popup must escape through a body portal with fixed positioning.
  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPopupPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 160 - 8)),
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
        className="flex h-8 max-w-32 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Reasoning effort 선택"
        aria-expanded={open}
      >
        <span className="truncate">{selected.label}</span>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[80] w-40 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, left: popupPosition.left }}
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold text-muted-foreground">
            Reasoning
          </p>
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent',
                option.value === value && 'bg-accent/70',
              )}
            >
              <span className="flex-1">{option.label}</span>
              {option.value === value && <Check className="size-3.5 text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
