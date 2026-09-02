/**
 * How much of a tool call the transcript shows before anyone clicks.
 *
 * One dial replaces two unrelated switches ("display reasoning", "display raw
 * parameters"): a reader scanning a long turn wants everything folded, a reader
 * debugging one wants everything open, and neither wanted to visit Settings
 * twice to get there. Every renderer that decides whether a card starts open
 * asks this module instead of carrying its own default, so the three levels
 * stay describable in one table (see `DENSITY_RULES`).
 *
 * A card the user opens or closes by hand keeps that state; switching level
 * remounts the cards, which is what resets those overrides.
 *
 * Failures are the one place the levels disagree about *when* to open rather
 * than *what*. Balanced and detailed unfold a failed call on the spot (group
 * row, shell output, subagent), because a folded failure is a failure nobody
 * reads. Compact does not: the row still carries the error label or badge, so
 * the failure is visible, but its body stays folded like every other body. A
 * session with thirty failed commands must never render *less* compact than
 * balanced, which is exactly what unconditional unfolding did.
 *
 * Above the cards sits one more fold, the turn's work block (`workBlock`,
 * `turnWork.ts`): every tool call between a user message and the answer,
 * folded into one row that reads `Reading src/foo.ts… · 12s` while the
 * run is going and `Worked for 42s · 5 files read · 3 commands · 2 edits` once
 * it is done. Compact and balanced fold; detailed shows the cards as they are.
 * The block never unfolds itself, not even for a failure: the row carries the
 * error label and the failed count, and `failureOpens` applies to the rows
 * inside once the reader opens it. Unfolding the whole turn's work because one
 * command exited non-zero would undo the fold the level exists for.
 */

export const TOOL_OUTPUT_DENSITIES = ['compact', 'balanced', 'detailed'] as const;

export type ToolOutputDensity = (typeof TOOL_OUTPUT_DENSITIES)[number];

export const DEFAULT_TOOL_OUTPUT_DENSITY: ToolOutputDensity = 'balanced';

export type ToolOutputDensityRules = {
  /** Consecutive same-tool calls at or above this count fold into one row. */
  groupThreshold: number;
  /** Shell output starts open. */
  bashOutputOpen: boolean;
  /**
   * A failed call unfolds on its own: the group row containing it, its shell
   * output, a failed subagent. Off, the row keeps its error label/badge and
   * the body waits for a click like everything else at that level.
   */
  failureOpens: boolean;
  /** Edit/Write diffs start open; closed, the row still carries the file and its +N/-M. */
  diffOpen: boolean;
  /** Other collapsible cards (todo lists, plans, generic parameters) start open. */
  collapsibleOpen: boolean | 'config';
  /** Reasoning rows are rendered at all. */
  showReasoning: boolean;
  /** Reasoning starts expanded. */
  reasoningOpen: boolean;
  /** The "raw params" disclosure is rendered under a card. */
  showRawParameters: boolean;
  /** A subagent container starts open, with its tool history unfolded. */
  subagentOpen: boolean;
  /** A subagent container shows its prompt and tool history at all. */
  subagentHistory: boolean;
  /**
   * A turn's tool calls fold into one work block with a summary row. Off, the
   * cards and same-tool groups render at the top level as they always did.
   */
  workBlock: boolean;
};

const DENSITY_RULES: Record<ToolOutputDensity, ToolOutputDensityRules> = {
  compact: {
    groupThreshold: 1,
    bashOutputOpen: false,
    failureOpens: false,
    diffOpen: false,
    collapsibleOpen: false,
    showReasoning: false,
    reasoningOpen: false,
    showRawParameters: false,
    subagentOpen: false,
    subagentHistory: false,
    workBlock: true,
  },
  balanced: {
    groupThreshold: 2,
    bashOutputOpen: false,
    failureOpens: true,
    diffOpen: true,
    collapsibleOpen: 'config',
    showReasoning: false,
    reasoningOpen: false,
    showRawParameters: false,
    subagentOpen: false,
    subagentHistory: true,
    workBlock: true,
  },
  detailed: {
    groupThreshold: Number.POSITIVE_INFINITY,
    bashOutputOpen: true,
    failureOpens: true,
    diffOpen: true,
    collapsibleOpen: true,
    showReasoning: true,
    reasoningOpen: true,
    showRawParameters: true,
    subagentOpen: true,
    subagentHistory: true,
    workBlock: false,
  },
};

export const isToolOutputDensity = (value: unknown): value is ToolOutputDensity =>
  typeof value === 'string' && (TOOL_OUTPUT_DENSITIES as readonly string[]).includes(value);

export const toolOutputDensityRules = (density: ToolOutputDensity | undefined): ToolOutputDensityRules =>
  DENSITY_RULES[density ?? DEFAULT_TOOL_OUTPUT_DENSITY];

/** compact -> balanced -> detailed -> compact, for the one-key quick toggle. */
export const nextToolOutputDensity = (current: ToolOutputDensity): ToolOutputDensity => {
  const index = TOOL_OUTPUT_DENSITIES.indexOf(current);
  return TOOL_OUTPUT_DENSITIES[(index + 1) % TOOL_OUTPUT_DENSITIES.length];
};

/** A collapsible card's initial state at this level, given what its config would have chosen. */
export const collapsibleStartsOpen = (rules: ToolOutputDensityRules, configDefault: boolean | undefined): boolean =>
  rules.collapsibleOpen === 'config' ? Boolean(configDefault) : rules.collapsibleOpen;

/**
 * The quick-toggle shortcut: Cmd/Ctrl+Shift+D ("density"). Cmd/Ctrl+K is the
 * palette and Escape stops a run; this is the third global chord and, like
 * the palette's, it carries a modifier so it can never collide with typing.
 */
export const cyclesToolOutputDensity = (event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>): boolean =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && !event.repeat && event.key.toLowerCase() === 'd';
