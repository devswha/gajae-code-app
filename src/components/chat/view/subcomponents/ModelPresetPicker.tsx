import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ProviderModelOption } from '../../../../types/app';

type ModelPresetPickerProps = {
  value: string;
  options: ProviderModelOption[];
  loading?: boolean;
  /** Monotonic signal (e.g. from the /model app command): each increment opens the popup. */
  openTrigger?: number;
  onSelect: (value: string) => Promise<unknown> | unknown;
};

const ROLE_LABELS = {
  default: 'Default',
  planner: 'Planner',
  executor: 'Executor',
  architect: 'Architect',
  critic: 'Critic',
} as const;

const UNGROUPED = '__ungrouped__';

function compactModelLabel(selector: string): string {
  const withoutProvider = selector.includes('/') ? selector.slice(selector.indexOf('/') + 1) : selector;
  return withoutProvider.replace(/:/, ' · ');
}

/** One-line summary of a preset: its default-role model, which is what users scan for. */
function presetSummary(option: ProviderModelOption): string {
  const defaultRole = option.roles?.default;
  return defaultRole ? compactModelLabel(defaultRole) : option.description ?? '';
}

function optionSearchText(option: ProviderModelOption): string {
  return [
    option.label,
    option.group ?? '',
    option.description ?? '',
    ...Object.values(option.roles ?? {}),
  ].join(' ').toLowerCase();
}

/**
 * Group the catalog like the GJC TUI's preset landing: ungrouped entries
 * (i.e. "Current") stay pinned on top, then one collapsed row per provider
 * family. A flat 30+ preset list with a five-role grid on every row is
 * unreadable, so role details render only for the active preset.
 */
function groupOptions(options: ProviderModelOption[]): Array<{ group: string; options: ProviderModelOption[] }> {
  const groups: Array<{ group: string; options: ProviderModelOption[] }> = [];
  const indexByGroup = new Map<string, number>();

  for (const option of options) {
    const group = option.group || UNGROUPED;
    const existing = indexByGroup.get(group);
    if (existing === undefined) {
      indexByGroup.set(group, groups.length);
      groups.push({ group, options: [option] });
    } else {
      groups[existing].options.push(option);
    }
  }

  return groups;
}

export default function ModelPresetPicker({ value, options, loading = false, openTrigger, onSelect }: ModelPresetPickerProps) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, right: 0 });

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );

  useEffect(() => {
    if (openTrigger) {
      setOpen(true);
    }
  }, [openTrigger]);

  // Opening lands on the active preset's group so the current choice is one
  // glance away instead of behind a collapsed row.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setExpandedGroup(selected?.group || null);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, selected?.group]);

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

  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(
    () => (normalizedQuery
      ? options.filter((option) => optionSearchText(option).includes(normalizedQuery))
      : []),
    [normalizedQuery, options],
  );
  const groups = useMemo(() => groupOptions(options), [options]);

  const choose = async (option: ProviderModelOption) => {
    if (option.value === value) {
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
  };

  const renderPresetRow = (option: ProviderModelOption, { indented }: { indented?: boolean } = {}) => {
    const isSelected = option.value === value;
    return (
      <button
        key={option.value}
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left transition-colors hover:bg-accent',
          indented ? 'pl-7' : 'pl-2.5',
          isSelected && 'bg-accent/70',
        )}
        onClick={() => { void choose(option); }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
        <span
          className="max-w-36 shrink-0 truncate text-[10px] text-muted-foreground"
          title={option.roles?.default ?? option.description}
        >
          {presetSummary(option)}
        </span>
        {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
      </button>
    );
  };

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
          className="fixed z-[80] w-96 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, right: popupPosition.right }}
        >
          <div className="px-2 pb-1.5 pt-1">
            <p className="text-xs font-semibold">모델 프리셋</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              기본 에이전트와 4개 전문 에이전트 구성을 함께 선택합니다.
            </p>
          </div>

          <div className="relative px-1 pb-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프리셋 검색"
              aria-label="프리셋 검색"
              className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          <div className="max-h-80 space-y-0.5 overflow-y-auto">
            {normalizedQuery ? (
              matches.length > 0
                ? matches.map((option) => renderPresetRow(option))
                : (
                  <p className="px-2.5 py-6 text-center text-[11px] text-muted-foreground">
                    일치하는 프리셋이 없습니다.
                  </p>
                )
            ) : (
              groups.map(({ group, options: groupOptionList }) => {
                if (group === UNGROUPED) {
                  return groupOptionList.map((option) => renderPresetRow(option));
                }

                const isExpanded = expandedGroup === group;
                const containsSelected = groupOptionList.some((option) => option.value === value);
                return (
                  <div key={group}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                      onClick={() => setExpandedGroup(isExpanded ? null : group)}
                      aria-expanded={isExpanded}
                    >
                      <ChevronRight
                        className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                      </span>
                      {containsSelected && !isExpanded && <Check className="size-3 shrink-0 text-primary" />}
                      <span className="shrink-0 text-[10px] text-muted-foreground">{groupOptionList.length}</span>
                    </button>
                    {isExpanded && groupOptionList.map((option) => renderPresetRow(option, { indented: true }))}
                  </div>
                );
              })
            )}
          </div>

          {selected?.roles && (
            <div className="mt-1 border-t border-border px-2.5 pb-1 pt-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                현재: {selected.label}
              </p>
              <div className="grid grid-cols-[4.25rem_1fr] gap-x-2 gap-y-1">
                {Object.entries(ROLE_LABELS).map(([role, label]) => {
                  const selector = selected.roles?.[role as keyof typeof ROLE_LABELS];
                  if (!selector) return null;
                  return (
                    <div key={role} className="contents">
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                      <span className="truncate text-[10px] text-foreground/80" title={selector}>
                        {compactModelLabel(selector)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
