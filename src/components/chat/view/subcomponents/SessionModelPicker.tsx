import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ProviderModelOption } from '../../../../types/app';

export const DEFAULT_MODEL_VALUE = 'default';

type SessionModelPickerProps = {
  /** Session-scoped selection: raw model id, `profile:*` preset, or `default`. */
  value: string;
  /** Model the session runtime last reported; wins for display when present. */
  currentModel?: string;
  /** Preset catalog; the raw model choices are derived from its role mappings. */
  presetOptions: ProviderModelOption[];
  loading?: boolean;
  onSelect: (modelId: string) => Promise<unknown> | unknown;
};

const compactModel = (modelId: string): string => modelId.split('/').pop() ?? modelId;

const providerOf = (modelId: string): string => (
  modelId.includes('/') ? modelId.slice(0, modelId.indexOf('/')) : ''
);

/**
 * Preset role selectors read `provider/model:effort`. Reasoning is chosen by
 * the effort picker next door, so the model list must offer only the base
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
 * prefix. The preset catalog is the only model inventory the server exposes,
 * and every model a preset can route to is by definition runnable, so the
 * union of role mappings is exactly the set of valid direct choices.
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

/**
 * Session default-model picker. Unlike the preset picker (which swaps the
 * whole five-role agent configuration), this changes only the model answering
 * this session's default agent, via the same per-session active-model store.
 */
export default function SessionModelPicker({
  value,
  currentModel,
  presetOptions,
  loading = false,
  onSelect,
}: SessionModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0 });

  const groups = useMemo(() => deriveSessionModelOptions(presetOptions), [presetOptions]);
  const displayModel = resolveDisplayModel(value, currentModel, presetOptions);
  const isRawSelection = value !== DEFAULT_MODEL_VALUE && !value.startsWith('profile:');

  // The composer form clips its children (overflow-hidden rounded corners), so
  // the popup must escape through a body portal with fixed positioning.
  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPopupPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 288 - 8)),
      });
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = async (modelId: string) => {
    if (modelId === value) {
      setOpen(false);
      return;
    }
    setSelecting(true);
    try {
      await onSelect(modelId);
      setOpen(false);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={loading || selecting || groups.length === 0}
        className="flex h-8 max-w-24 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 sm:max-w-40"
        aria-label="세션 모델 선택"
        aria-expanded={open}
        title={displayModel ?? '세션 모델 선택'}
      >
        {(loading || selecting) && <Loader2 className="size-3 animate-spin" />}
        <span className="truncate">{displayModel ? compactModel(displayModel) : 'Model'}</span>
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[80] w-72 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, left: popupPosition.left }}
        >
          <div className="px-2 pb-1.5 pt-1">
            <p className="text-xs font-semibold">세션 모델</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              이 세션의 기본 에이전트가 사용할 모델만 바꿉니다.
            </p>
          </div>

          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => { void choose(DEFAULT_MODEL_VALUE); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent',
                !isRawSelection && 'bg-accent/70',
              )}
            >
              <span className="min-w-0 flex-1 truncate font-medium">Default</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">현재 구성 사용</span>
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
                      onClick={() => { void choose(model); }}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
