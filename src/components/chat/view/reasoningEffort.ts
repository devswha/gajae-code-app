/** Reasoning levels accepted by the GJC runtime and session state. */
export type ReasoningEffort =
  | 'default'
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  default: 'Default',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/**
 * Label for an effort level. The runtime can report a level this picker does
 * not offer, and showing that raw value is better than pretending it is the
 * default.
 */
export function reasoningEffortLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Own keys only: `labels['toString']` is a function, not a label.
  return isReasoningEffort(value) ? REASONING_EFFORT_LABELS[value] : value;
}

/** Whether a string is one of the levels this picker knows, prototype keys excluded. */
export function isReasoningEffort(value: string): value is ReasoningEffort {
  return Object.prototype.hasOwnProperty.call(REASONING_EFFORT_LABELS, value);
}

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = (
  Object.keys(REASONING_EFFORT_LABELS) as ReasoningEffort[]
).map((value) => ({ value, label: REASONING_EFFORT_LABELS[value] }));

/** Where the standing reasoning choice lives, beside the composer's `gjc-model`. */
const REASONING_EFFORT_STORAGE_KEY = 'gjc-reasoning-effort';

/**
 * The effort the composer starts from: the level this browser last chose.
 *
 * Every message carries the composer's effort, so this value is what the next
 * turn runs with — it has to outlive a session switch and a reload the same
 * way the chosen model does. Without it the control forgot the choice on every
 * mount and every switch, and said "Default" for the rest of the session.
 */
export function readReasoningEffort(): ReasoningEffort {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(REASONING_EFFORT_STORAGE_KEY);
    return stored && isReasoningEffort(stored) ? stored : 'default';
  } catch {
    // A blocked or unavailable storage is not a reason to lose the composer.
    return 'default';
  }
}

/** Records an explicit choice; a level the runtime reports is not one. */
export function rememberReasoningEffort(value: ReasoningEffort): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, value);
  } catch {
    // A full or blocked storage must not take the picker down with it.
  }
}
