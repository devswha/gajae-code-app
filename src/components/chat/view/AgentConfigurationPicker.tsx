import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Boxes, Check, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';

import { focusSearchInputSafely } from '../../../hooks/useDeviceSettings';
import { primaryModelSelector } from '../../../../shared/model-selectors';
import { cn } from '../../../utils/cn';
import type { ProviderModelOption } from '../../../types/app';

import { providerDisplayLabel, providerOf, stripEffortSuffix } from './ModelAndReasoningPicker';

type AgentConfigurationPickerProps = {
  value: string;
  options: ProviderModelOption[];
  loading?: boolean;
  /** Monotonic signal (e.g. from the /model app command): each increment opens the popup. */
  openTrigger?: number;
  /** Compact icon trigger for toolbar placement next to the skill picker. */
  iconOnly?: boolean;
  /** Runtime model metadata: the word on which models the stored subscriptions can run. */
  modelOptions?: ProviderModelOption[];
  /**
   * Whether `modelOptions` is the runtime's answer (true, even when empty:
   * nobody signed in) or missing because the runtime could not be asked. Only
   * a known answer dims presets; unknown availability keeps every preset lit.
   */
  availabilityKnown?: boolean;
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

/** Display order requested for preset groups; unlisted groups keep catalog order after these. */
const GROUP_ORDER = ['CODEX', 'CLAUDE', 'KIMI CODING PLAN', 'GLM', 'GROK'];

const groupRank = (group: string): number => {
  if (group === UNGROUPED) return -1;
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
};

function compactModelLabel(selector: string): string {
  const primary = primaryModelSelector(selector) ?? '';
  const withoutProvider = primary.includes('/') ? primary.slice(primary.indexOf('/') + 1) : primary;
  return withoutProvider.replace(/:/, ' · ');
}

const modelSelectorTitle = (selector: string): string => primaryModelSelector(selector) ?? '';

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

  // Stable sort: pinned "Current" first, then the requested group order,
  // then remaining groups in catalog order.
  return groups
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      groupRank(left.entry.group) - groupRank(right.entry.group) || left.index - right.index
    ))
    .map(({ entry }) => entry);
}

/**
 * Distinct providers (in first-seen order) named by a preset's role
 * selectors. Mirrors the model picker's own provider derivation so the
 * "sign in required" tooltip can name the same providers, not the catalog
 * group or preset label.
 */
export function presetProviders(option: ProviderModelOption): string[] {
  const providers: string[] = [];
  for (const selector of Object.values(option.roles ?? {})) {
    if (typeof selector !== 'string') continue;
    const model = stripEffortSuffix(selector.trim());
    if (!model.includes('/')) continue;
    const provider = providerOf(model);
    if (provider && !providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

/** Renders provider ids as the comma-separated display text for the sign-in tooltip. */
function signInProviderLabel(providers: string[], fallback: string): string {
  return providers.length > 0 ? providers.map(providerDisplayLabel).join(', ') : fallback;
}

/**
 * Per-preset availability, derived the same way the model picker derives it:
 * the runtime's model list is the word on what the stored subscriptions can
 * run. A preset stays lit while any of its role models is runnable; it dims
 * only when the runtime answered and listed none of them. A preset that names
 * no model (empty roles, profile-name references) cannot be judged and stays
 * lit, and unknown availability (`availabilityKnown` false: no MODELS, worker
 * startup failure, stale cache) never dims anything.
 */
export function derivePresetAvailability(
  options: ProviderModelOption[],
  modelOptions: ProviderModelOption[] = [],
  availabilityKnown = false,
): Map<string, boolean> {
  const runnable = new Set(
    modelOptions
      .map((option) => stripEffortSuffix(option.value.trim()))
      .filter((model) => model.includes('/')),
  );
  const availability = new Map<string, boolean>();
  for (const option of options) {
    const models = Object.values(option.roles ?? {})
      .filter((selector): selector is string => typeof selector === 'string')
      .map((selector) => stripEffortSuffix(selector.trim()))
      .filter((model) => model.includes('/'));
    availability.set(
      option.value,
      !availabilityKnown || models.length === 0 || models.some((model) => runnable.has(model)),
    );
  }
  return availability;
}

export default function AgentConfigurationPicker({ value, options, loading = false, openTrigger, iconOnly = false, modelOptions = [], availabilityKnown = false, onSelect }: AgentConfigurationPickerProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0, maxHeight: 0 });

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
    focusSearchInputSafely(searchRef.current);
  }, [open, selected?.group]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) {
        // Left-anchored and clamped like the model and skill popups: a
        // right-anchored w-96 popup grows left off the viewport on phones,
        // cutting off its own list.
        setPopupPosition({
          bottom: window.innerHeight - rect.top + 8,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 384 - 8)),
          // The role summary makes this popup taller than the model picker.
          // Bound it to the space above the trigger so its header and first
          // provider groups never disappear beyond the top of the viewport.
          maxHeight: Math.max(0, rect.top - 16),
        });
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(
    () => (normalizedQuery
      ? options.filter((option) => optionSearchText(option).includes(normalizedQuery))
      : []),
    [normalizedQuery, options],
  );
  const groups = useMemo(() => groupOptions(options), [options]);
  const availability = useMemo(
    () => derivePresetAvailability(options, modelOptions, availabilityKnown),
    [options, modelOptions, availabilityKnown],
  );

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
    const available = availability.get(option.value) ?? true;
    return (
      <button
        key={option.value}
        type="button"
        disabled={!available}
        aria-disabled={!available || undefined}
        data-available={available}
        title={available
          ? undefined
          : t('input.agentConfiguration.signInRequired', {
            provider: signInProviderLabel(presetProviders(option), option.group ?? option.label),
          })}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left transition-colors hover:bg-accent',
          indented ? 'pl-7' : 'pl-2.5',
          isSelected && 'bg-accent/70',
          !available && 'cursor-not-allowed text-muted-foreground/50 hover:bg-transparent',
        )}
        onClick={() => { void choose(option); }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
        <span
          className="max-w-36 shrink-0 truncate text-[10px] text-muted-foreground"
          title={option.roles?.default ? modelSelectorTitle(option.roles.default) : option.description}
        >
          {presetSummary(option)}
        </span>
        {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={loading || selecting || options.length === 0}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label={t('input.agentConfiguration.label')}
          aria-expanded={open}
          title={`${t('input.agentConfiguration.title')}: ${selected?.label ?? 'Current'}`}
        >
          {(loading || selecting) ? <Loader2 className="size-4 animate-spin" /> : <Boxes className="size-4" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={loading || selecting || options.length === 0}
          className="flex h-8 max-w-40 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          aria-label={t('input.agentConfiguration.label')}
          aria-expanded={open}
        >
          {(loading || selecting) && <Loader2 className="size-3 animate-spin" />}
          <span className="truncate">{selected?.label ?? 'Current'}</span>
          <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
        </button>
      )}

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-80 flex w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{
            bottom: popupPosition.bottom,
            left: popupPosition.left,
            maxHeight: popupPosition.maxHeight,
          }}
        >
          <div className="px-2 pt-1 pb-1.5">
            <p className="text-xs font-semibold">{t('input.agentConfiguration.title')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t('input.agentConfiguration.description')}
            </p>
          </div>

          <div className="relative px-1 pb-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('input.agentConfiguration.search')}
              aria-label={t('input.agentConfiguration.search')}
              className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-hidden placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          <div className="max-h-80 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {normalizedQuery ? (
              matches.length > 0
                ? matches.map((option) => renderPresetRow(option))
                : (
                  <p className="px-2.5 py-6 text-center text-[11px] text-muted-foreground">
                    {t('input.agentConfiguration.noMatches')}
                  </p>
                )
            ) : (
              groups.map(({ group, options: groupOptionList }) => {
                if (group === UNGROUPED) {
                  return groupOptionList.map((option) => renderPresetRow(option));
                }

                const isExpanded = expandedGroup === group;
                const containsSelected = groupOptionList.some((option) => option.value === value);
                const groupAvailable = groupOptionList.some((option) => availability.get(option.value) ?? true);
                const groupProviders: string[] = [];
                for (const option of groupOptionList) {
                  for (const provider of presetProviders(option)) {
                    if (!groupProviders.includes(provider)) groupProviders.push(provider);
                  }
                }
                return (
                  <div key={group}>
                    <button
                      type="button"
                      data-available={groupAvailable}
                      title={groupAvailable
                        ? undefined
                        : t('input.agentConfiguration.signInRequired', {
                          provider: signInProviderLabel(groupProviders, group),
                        })}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                      onClick={() => setExpandedGroup(isExpanded ? null : group)}
                      aria-expanded={isExpanded}
                    >
                      <ChevronRight
                        className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide uppercase',
                          groupAvailable ? 'text-muted-foreground' : 'text-muted-foreground/50',
                        )}
                      >
                        {group}
                      </span>
                      {containsSelected && !isExpanded && <Check className="size-3 shrink-0 text-primary" />}
                      <span className={cn('shrink-0 text-[10px]', groupAvailable ? 'text-muted-foreground' : 'text-muted-foreground/50')}>
                        {groupOptionList.length}
                      </span>
                    </button>
                    {isExpanded && groupOptionList.map((option) => renderPresetRow(option, { indented: true }))}
                  </div>
                );
              })
            )}
          </div>

          {selected?.roles && (
            <div className="mt-1 border-t border-border px-2.5 pt-2 pb-1">
              <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                현재: {selected.label}
              </p>
              <div className="grid grid-cols-[4.25rem_1fr] gap-x-2 gap-y-1">
                {Object.entries(ROLE_LABELS).map(([role, label]) => {
                  const selector = selected.roles?.[role as keyof typeof ROLE_LABELS];
                  if (!selector) return null;
                  return (
                    <div key={role} className="contents">
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                      <span className="truncate text-[10px] text-foreground/80" title={modelSelectorTitle(selector)}>
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
