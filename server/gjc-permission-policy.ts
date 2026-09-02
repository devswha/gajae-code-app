/**
 * Per-project permission policy shared by the app process and the GJC worker.
 *
 * The runtime (`@gajae-code/coding-agent`) gates `bash`, `monitor`, `eval`,
 * `delete`, `move` and destructive `edit` intents behind a permission provider
 * once a session's SDK permission mode is `prompt`. This module is the policy
 * both sides agree on: which mode a run is in, which tools the project has
 * marked "always allow", and how a gated call resolves without a human.
 */

export const GJC_PERMISSION_MODES = ['ask', 'auto_edits', 'bypass'] as const;
export type GjcPermissionMode = typeof GJC_PERMISSION_MODES[number];
export const DEFAULT_GJC_PERMISSION_MODE: GjcPermissionMode = 'ask';

export type GjcRunPermissions = {
  mode: GjcPermissionMode;
  /** Tool names the project approved with "Always allow"; lowercase runtime names. */
  allowAlways: string[];
};

export type GjcAutoApprovalReason = 'bypass' | 'always_allow' | 'auto_edits';

/**
 * Tools `auto_edits` approves without asking. The runtime only gates `edit` for
 * delete/move intents and never gates `write`; the set still names every file
 * mutation tool so the policy reads as "file edits pass, everything else asks"
 * even if the runtime widens its gate later.
 */
export const GJC_AUTO_EDIT_TOOLS: ReadonlySet<string> = new Set(['edit', 'write', 'delete', 'move']);

const TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

/** Application error code a worker answers a run with when its policy block is malformed. */
export const GJC_INVALID_PERMISSIONS_CODE = 'invalid_permissions';
/** Fixed text for that failure; safe to relay to a browser because it carries no frame content. */
export const GJC_INVALID_PERMISSIONS_MESSAGE = 'Invalid GJC run permissions.';

export class GjcRunPermissionsError extends Error {
  readonly code = GJC_INVALID_PERMISSIONS_CODE;

  constructor() {
    super(GJC_INVALID_PERMISSIONS_MESSAGE);
    this.name = 'GjcRunPermissionsError';
  }
}

export function isGjcRunPermissionsError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === GJC_INVALID_PERMISSIONS_CODE;
}

export function isGjcPermissionMode(value: unknown): value is GjcPermissionMode {
  return typeof value === 'string' && (GJC_PERMISSION_MODES as readonly string[]).includes(value);
}

/** Accepts only the runtime's own lowercase tool identifiers. */
export function isGjcPermissionToolName(value: unknown): value is string {
  return typeof value === 'string' && TOOL_NAME.test(value);
}

/**
 * Validates the `permissions` block of a run's options. Returns `undefined`
 * when the block is absent (the caller keeps the runtime's own default) and
 * throws on anything malformed, so a typo cannot silently widen a policy.
 */
export function parseGjcRunPermissions(value: unknown): GjcRunPermissions | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GjcRunPermissionsError();
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => key === 'mode' || key === 'allowAlways')) {
    throw new GjcRunPermissionsError();
  }
  if (!isGjcPermissionMode(record.mode)) throw new GjcRunPermissionsError();
  const allowAlways = record.allowAlways ?? [];
  if (!Array.isArray(allowAlways) || !allowAlways.every(isGjcPermissionToolName)) {
    throw new GjcRunPermissionsError();
  }
  return { mode: record.mode, allowAlways: [...new Set(allowAlways)] };
}

/**
 * Why a gated tool call may proceed without a card, or `null` when a human
 * must decide. `bypass` outranks the allow-list so a transcript notice names
 * the mode the user actually switched on.
 */
export function gjcAutoApprovalReason(
  permissions: GjcRunPermissions,
  toolName: string,
): GjcAutoApprovalReason | null {
  if (permissions.mode === 'bypass') return 'bypass';
  if (permissions.allowAlways.includes(toolName)) return 'always_allow';
  if (permissions.mode === 'auto_edits' && GJC_AUTO_EDIT_TOOLS.has(toolName)) return 'auto_edits';
  return null;
}

const REASON_LABELS: Record<GjcAutoApprovalReason, string> = {
  bypass: 'bypass',
  always_allow: 'always allow',
  auto_edits: 'auto-approve edits',
};

/** The transcript notice: "Auto-approved bash (always allow)". */
export function gjcAutoApprovalNotice(toolName: string, reason: GjcAutoApprovalReason): string {
  return `Auto-approved ${toolName} (${REASON_LABELS[reason]})`;
}
