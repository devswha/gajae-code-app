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
  return REASONING_EFFORT_LABELS[value as ReasoningEffort] ?? value;
}

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = (
  Object.keys(REASONING_EFFORT_LABELS) as ReasoningEffort[]
).map((value) => ({ value, label: REASONING_EFFORT_LABELS[value] }));
