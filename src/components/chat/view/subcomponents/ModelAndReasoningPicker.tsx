import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronLeft, Loader2 } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ProviderModelOption } from '../../../../types/app';

import {
  REASONING_EFFORT_LABELS,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from './reasoningEffort';

export const DEFAULT_MODEL_VALUE = 'default';

type ModelAndReasoningPickerProps = {
  /** Session-scoped selection: raw model id, `profile:*` preset, or `default`. */
  value: string;
  /** Model the session runtime last reported; wins for display when present. */
  currentModel?: string;
  /** Preset catalog; the raw model choices are derived from its role mappings. */
  presetOptions: ProviderModelOption[];
  /** Runtime model metadata, including the exact efforts GJC exposes per model. */
  modelOptions: ProviderModelOption[];
  loading?: boolean;
  onSelect: (modelId: string) => Promise<unknown> | unknown;
  reasoningEffort: ReasoningEffort;
  onSelectReasoningEffort: (value: ReasoningEffort) => void;
};

const compactModel = (modelId: string): string => modelId.split('/').pop() ?? modelId;

const providerOf = (modelId: string): string => (
  modelId.includes('/') ? modelId.slice(0, modelId.indexOf('/')) : ''
);

/**
 * Preset role selectors read `provider/model:effort`. Reasoning is chosen by
 * the second step of this picker, so the model list must offer only the base
 * model id — otherwise every effort variant shows up as its own "model".
 */
export const stripEffortSuffix = (selector: string): string =>
  selector.replace(/:(?:off|minimal|low|medium|high|xhigh|max)$/, '');

/** Display order requested for provider groups; unlisted providers follow alphabetically. */
const PROVIDER_ORDER = ['openai-codex', 'anthropic', 'kimi-code', 'zai', 'xai', 'grok-build'];

const providerRank = (provider: string): number => {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? PROVIDER_ORDER.length : index;
};

/**
 * Unique raw model ids mentioned by any preset role, grouped by provider
 * prefix. Runtime metadata supplies capabilities for these rows separately;
 * role mappings remain the authority for which models this focused picker
 * offers.
 */
export function deriveSessionModelOptions(
  presetOptions: ProviderModelOption[],
): Array<{ group: string; models: string[] }> {
  const seen = new Set<string>();
  for (const option of presetOptions) {
    for (const selector of Object.values(option.roles ?? {})) {
      // A model selector always reads provider/model; anything else (e.g. a
      // profile name leaking out of config.yml) is not a selectable model.
      if (typeof selector === 'string' && selector.includes('/')) seen.add(stripEffortSuffix(selector.trim()));
    }
  }
  const groups = new Map<string, string[]>();
  for (const model of [...seen].sort()) {
    const group = providerOf(model) || 'other';
    const bucket = groups.get(group);
    if (bucket) bucket.push(model);
    else groups.set(group, [model]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => providerRank(left) - providerRank(right) || left.localeCompare(right))
    .map(([group, models]) => ({ group, models }));
}

/**
 * Resolves which model id the trigger button should display: the live session
 * report wins, then an explicit raw selection, then the default-role model of
 * the selected (or current) preset.
 */
export function resolveDisplayModel(
  value: string,
  currentModel: string | undefined,
  presetOptions: ProviderModelOption[],
): string | undefined {
  if (currentModel?.trim()) return stripEffortSuffix(currentModel.trim());
  if (value && value !== DEFAULT_MODEL_VALUE && !value.startsWith('profile:')) return value;
  const preset = presetOptions.find((option) => option.value === value)
    ?? presetOptions.find((option) => option.value === DEFAULT_MODEL_VALUE);
  const role = preset?.roles?.default;
  if (!role) return undefined;
  if (role.includes('/')) return stripEffortSuffix(role);
  // A profile-name reference (no provider prefix): resolve one level through
  // the referenced preset's own default role.
  const referenced = presetOptions.find((option) => option.value === `profile:${role}`)?.roles?.default;
  return referenced?.includes('/') ? stripEffortSuffix(referenced) : undefined;
}

export function reasoningOptionsForModel(
  modelId: string | undefined,
  modelOptions: ProviderModelOption[],
): ReasoningEffort[] {
  if (!modelId) return [];
  const model = modelOptions.find((option) => option.value === modelId);
  const supported = model?.effort?.values
    .map((option) => option.value)
    .filter((value): value is ReasoningEffort =>
      value !== 'default' && value !== 'off' && value in REASONING_EFFORT_LABELS,
    ) ?? [];
  return supported.length > 0 ? ['default', 'off', ...new Set(supported)] : [];
}

/**
 * One composer control for the two settings that define the next answer:
 * the session's chat model and its reasoning effort. The separate preset
 * control still owns the full multi-role agent configuration.
 */
export default function ModelAndReasoningPicker({
  value,
  currentModel,
  presetOptions,
  modelOptions,
  loading = false,
  onSelect,
  reasoningEffort,
  onSelectReasoningEffort,
}: ModelAndReasoningPickerProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0 });

  const groups = useMemo(() => deriveSessionModelOptions(presetOptions), [presetOptions]);
  const displayModel = resolveDisplayModel(value, currentModel, presetOptions);
  const isRawSelection = value !== DEFAULT_MODEL_VALUE && !value.startsWith('profile:');
  const reasoningLabel = REASONING_EFFORT_LABELS[reasoningEffort];
  const pendingModelId = pendingModel === DEFAULT_MODEL_VALUE ? displayModel : pendingModel;
  const pendingReasoningOptions = reasoningOptionsForModel(pendingModelId ?? undefined, modelOptions);

  // The composer form clips its children (overflow-hidden rounded corners), so
  // the popup must escape through a body portal with fixed positioning.
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
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) setPendingModel(null);
  }, [open]);

  const commitSelection = async (modelId: string, effort: ReasoningEffort) => {
    setSelecting(true);
    try {
      if (modelId !== value) await onSelect(modelId);
      onSelectReasoningEffort(effort);
      setOpen(false);
    } finally {
      setSelecting(false);
    }
  };

  const chooseModel = (modelId: string) => {
    const resolvedModel = modelId === DEFAULT_MODEL_VALUE ? displayModel : modelId;
    const options = reasoningOptionsForModel(resolvedModel, modelOptions);
    if (options.length > 0) {
      setPendingModel(modelId);
      return;
    }
    void commitSelection(modelId, 'default');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={loading || selecting || groups.length === 0}
        className="flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 sm:max-w-56"
        aria-label={t('input.modelReasoning.label')}
        aria-expanded={open}
        title={`${displayModel ?? t('input.modelReasoning.defaultModel')} · ${reasoningLabel}`}
      >
        {(loading || selecting) && <Loader2 className="size-3 animate-spin" />}
        <span className="min-w-0 truncate">
          {displayModel ? compactModel(displayModel) : t('input.modelReasoning.defaultModel')}
        </span>
        <span className="shrink-0 text-border" aria-hidden>·</span>
        <span className="shrink-0">{reasoningLabel}</span>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[80] w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, left: popupPosition.left }}
        >
          {pendingModel === null ? (
            <>
              <div className="px-2 pb-1.5 pt-1">
                <p className="text-xs font-semibold">{t('input.modelReasoning.modelTitle')}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('input.modelReasoning.modelDescription')}
                </p>
              </div>

              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => chooseModel(DEFAULT_MODEL_VALUE)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent',
                    !isRawSelection && 'bg-accent/70',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {t('input.modelReasoning.defaultModel')}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t('input.modelReasoning.currentConfiguration')}
                  </span>
                  {!isRawSelection && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>

                {groups.map(({ group, models }) => (
                  <div key={group}>
                    <p className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </p>
                    {models.map((model) => {
                      const isSelected = value === model;
                      return (
                        <button
                          key={model}
                          type="button"
                          onClick={() => chooseModel(model)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent',
                            isSelected && 'bg-accent/70',
                          )}
                          title={model}
                        >
                          <span className="min-w-0 flex-1 truncate">{compactModel(model)}</span>
                          {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="p-1">
              <button
                type="button"
                onClick={() => setPendingModel(null)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent"
                aria-label={t('input.modelReasoning.modelTitle')}
              >
                <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-xs font-semibold">
                  {pendingModelId ? compactModel(pendingModelId) : t('input.modelReasoning.defaultModel')}
                </span>
              </button>
              <p className="px-1.5 pb-1 pt-2 text-xs font-semibold">
                {t('input.modelReasoning.reasoningTitle')}
              </p>
              <p className="px-1.5 text-[11px] text-muted-foreground">
                {t('input.modelReasoning.reasoningDescription')}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {REASONING_EFFORT_OPTIONS
                  .filter((option) => pendingReasoningOptions.includes(option.value))
                  .map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => { void commitSelection(pendingModel, option.value); }}
                      className="flex items-center justify-between rounded-lg border border-border/60 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
                    >
                      <span>{option.label}</span>
                      <ChevronDown className="size-3 -rotate-90" aria-hidden />
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
