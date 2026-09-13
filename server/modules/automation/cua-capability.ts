/**
 * Trusted server-side capability boundary for CUA Driver 0.21.0.
 *
 * Every managed-agent computer action funnels through `guardCuaCall` before it
 * can reach the driver transport. The policy encoded here is deliberately
 * narrow: it mirrors the argument schemas published by
 * `cua-driver describe <tool>` at version 0.21.0 and rejects everything the
 * driver does not document, everything that is ambiguous, and everything that
 * could reach the user's foreground session.
 *
 * PR-03 policy: the managed `computer` path is BACKGROUND ONLY.
 *  - `delivery_mode: 'foreground'` is denied.
 *  - `scope: 'desktop'` input delivery is denied.
 *  - real OS pointer movement is denied.
 *  - unbound (whole-desktop) input is denied.
 *  - unknown tools and unknown arguments fail closed.
 *
 * This module owns policy so that the bridge, the HTTP route and any future
 * caller share one authoritative implementation. It performs no I/O.
 */

/** Driver release whose published schemas this policy was derived from. */
export const CUA_DRIVER_SCHEMA_VERSION = '0.21.0';

/** Driver releases whose schemas are known to match {@link CUA_TOOL_POLICIES}. */
const SUPPORTED_DRIVER_MINORS = new Set(['0.21']);

export class CuaPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CuaPolicyError';
  }
}

function deny(reason: string): never {
  throw new CuaPolicyError(`cua_policy_denied: ${reason}`);
}

/* -------------------------------------------------------------------------- */
/* Permission inspection                                                      */
/* -------------------------------------------------------------------------- */

/** Tri-state: `undefined` means "not proven", and is never treated as granted. */
export type CuaPermissionState = boolean | undefined;

export type CuaPermissionReport = {
  accessibility: CuaPermissionState;
  screenRecording: CuaPermissionState;
  /** Which parser produced this report. */
  source: 'structured' | 'legacy-text' | 'none';
  /** TCC identity the driver attributed the answer to, when it reported one. */
  attribution?: string;
};

const UNKNOWN_REPORT: CuaPermissionReport = {
  accessibility: undefined,
  screenRecording: undefined,
  source: 'none',
};

/**
 * `cua-driver permissions status` answers through the running daemon, so the
 * booleans carry the daemon's own TCC identity. Any other attribution — most
 * importantly "no daemon is running", which the CLI documents as reporting
 * `unknown` rather than the caller's grants — must fail closed.
 */
const TRUSTED_PERMISSION_ATTRIBUTIONS = new Set(['driver-daemon']);

/** Only an explicit JSON `true` is a grant. null/missing/other stays unknown. */
function strictBoolean(value: unknown): CuaPermissionState {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

/**
 * Primary mechanism: the documented `cua-driver permissions status --json`
 * payload. Returns `null` when the output is not that payload at all, so the
 * caller can decide whether to fall back; returns an all-unknown report when
 * the payload is present but untrustworthy.
 */
export function parseCuaPermissionsJson(raw: string): CuaPermissionReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  // Require at least one documented permission key so unrelated JSON output is
  // not mistaken for a permission payload.
  if (!Object.hasOwn(record, 'accessibility') && !Object.hasOwn(record, 'screen_recording')) return null;

  const rawSource = record.source;
  const source = rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)
    ? rawSource as Record<string, unknown>
    : {};
  const attribution = typeof source.attribution === 'string' ? source.attribution : undefined;
  if (!attribution || !TRUSTED_PERMISSION_ATTRIBUTIONS.has(attribution)) {
    // Unknown attribution (including no running daemon) proves nothing.
    return { ...UNKNOWN_REPORT, source: 'structured', ...(attribution ? { attribution } : {}) };
  }
  return {
    accessibility: strictBoolean(record.accessibility),
    screenRecording: strictBoolean(record.screen_recording),
    source: 'structured',
    attribution,
  };
}

const LEGACY_GRANTED = new Set(['granted', 'authorized', 'authorised', 'enabled', 'allowed', 'yes', 'true']);
const LEGACY_DENIED = new Set([
  'not granted', 'denied', 'not authorized', 'not authorised', 'unauthorized', 'unauthorised',
  'disabled', 'not enabled', 'restricted', 'no', 'false',
]);

/**
 * Reduce one `Label: value` line to a bare value token.
 *
 * Deliberately bounded: the value must be the WHOLE remainder of the line
 * (minus status glyphs and a trailing parenthetical note), and it is then
 * matched by exact token equality. Substring matching is what allowed
 * "not granted" and "unauthorized" to read as granted in the audited parser.
 */
function legacyPermissionToken(line: string, label: string): string | null {
  const separator = line.indexOf(':');
  if (separator < 0) return null;
  if (line.slice(0, separator).trim().toLowerCase() !== label) return null;
  return line
    .slice(separator + 1)
    .replace(/\([^)]*\)\s*$/u, '')
    .replace(/\u2705|\u274C|\u2753|\u26A0\uFE0F?|\uFE0F/gu, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function legacyPermissionValue(output: string, labels: readonly string[]): CuaPermissionState {
  for (const line of output.split(/\r?\n/u)) {
    for (const label of labels) {
      const token = legacyPermissionToken(line, label);
      if (token === null) continue;
      if (LEGACY_GRANTED.has(token)) return true;
      if (LEGACY_DENIED.has(token)) return false;
      // Recognised label, unrecognised value: explicitly unknown.
      return undefined;
    }
  }
  return undefined;
}

/**
 * Bounded compatibility fallback for a driver that does not implement
 * `--json`. Never upgrades an unrecognised or negated value to `true`.
 */
export function parseCuaPermissionsText(raw: string): CuaPermissionReport {
  if (!raw.trim()) return UNKNOWN_REPORT;
  const attributionLine = raw.split(/\r?\n/u)
    .map((line) => legacyPermissionToken(line, 'source'))
    .find((token): token is string => token !== null && token.length > 0);
  if (attributionLine && !TRUSTED_PERMISSION_ATTRIBUTIONS.has(attributionLine)) {
    return { ...UNKNOWN_REPORT, source: 'legacy-text', attribution: attributionLine };
  }
  return {
    accessibility: legacyPermissionValue(raw, ['accessibility']),
    screenRecording: legacyPermissionValue(raw, ['screen recording', 'screen capture']),
    source: 'legacy-text',
    ...(attributionLine ? { attribution: attributionLine } : {}),
  };
}

/**
 * Structured payload first, bounded text second, unknown last.
 * `ok` reports whether the inspection command itself succeeded; a failed
 * inspection can never produce a grant.
 */
export function readCuaPermissions(inspection: { ok: boolean; output: string }): CuaPermissionReport {
  if (!inspection.ok) {
    const structured = parseCuaPermissionsJson(inspection.output);
    // A non-zero exit is not proof of anything; only keep explicit denials.
    if (structured) return { ...structured, accessibility: structured.accessibility === false ? false : undefined,
      screenRecording: structured.screenRecording === false ? false : undefined };
    return UNKNOWN_REPORT;
  }
  return parseCuaPermissionsJson(inspection.output) ?? parseCuaPermissionsText(inspection.output);
}

/** Whether the installed driver reports a release this policy was derived from. */
export function isCuaDriverSchemaSupported(version: string | undefined): boolean {
  const match = /(\d+)\.(\d+)\.\d+/u.exec(version ?? '');
  return Boolean(match) && SUPPORTED_DRIVER_MINORS.has(`${match![1]}.${match![2]}`);
}

/* -------------------------------------------------------------------------- */
/* Argument policy                                                            */
/* -------------------------------------------------------------------------- */

type CuaToolPolicy = {
  /**
   * Argument keys forwarded to the driver. Anything absent from this list is
   * rejected: the driver's own schemas are `additionalProperties: false`, and
   * an argument this policy has not reviewed is an unknown capability.
   */
  readonly allowed: readonly string[];
  /** Keys the driver accepts but the managed path refuses to expose. */
  readonly withheld?: readonly string[];
  /** Argument keys that must be present. */
  readonly required?: readonly string[];
  /** Driver 0.21.0 publishes `delivery_mode` on this tool. */
  readonly deliveryMode?: boolean;
  /** Tool delivers synthetic input and therefore needs a bound target. */
  readonly input?: boolean;
  /** Tool needs `pid` to identify its target. */
  readonly requiresPid?: boolean;
  /** Tool needs `window_id` to identify its target. */
  readonly requiresWindowId?: boolean;
};

/**
 * Derived from `cua-driver describe <tool>` at 0.21.0. `session` is accepted
 * everywhere because the service injects its own private label.
 */
const CUA_TOOL_POLICIES: Readonly<Record<string, CuaToolPolicy>> = {
  // --- lifecycle -----------------------------------------------------------
  start_session: { allowed: ['session'] },
  end_session: { allowed: ['session'] },

  // --- read-only discovery -------------------------------------------------
  list_apps: { allowed: ['session'] },
  list_windows: { allowed: ['session', 'pid', 'on_screen_only'] },
  get_accessibility_tree: { allowed: ['session'] },
  get_window_state: {
    // `screenshot_out_file` writes an operator-chosen path; `capture_mode` is
    // documented as deprecated and ignored, i.e. ambiguous. Both are withheld.
    allowed: ['session', 'pid', 'window_id', 'include_screenshot', 'max_depth', 'max_elements', 'query'],
    withheld: ['screenshot_out_file', 'capture_mode'],
    required: ['pid', 'window_id'],
    requiresPid: true,
    requiresWindowId: true,
  },

  // --- background input ----------------------------------------------------
  click: {
    allowed: ['session', 'pid', 'window_id', 'element_index', 'element_token', 'snapshot_id',
      'x', 'y', 'button', 'count', 'action', 'from_zoom', 'delivery_mode', 'scope', 'target'],
    // `debug_image_out` writes an operator-chosen path. `modifier` is documented
    // as requiring foreground delivery, which this path denies outright.
    withheld: ['debug_image_out', 'modifier'],
    deliveryMode: true,
    input: true,
    requiresPid: true,
  },
  type_text: {
    allowed: ['session', 'pid', 'window_id', 'element_index', 'element_token', 'snapshot_id',
      'text', 'x', 'y', 'delay_ms', 'delivery_mode', 'scope', 'target'],
    required: ['text'],
    deliveryMode: true,
    input: true,
    requiresPid: true,
  },
  press_key: {
    allowed: ['session', 'pid', 'window_id', 'element_index', 'element_token', 'snapshot_id',
      'key', 'modifiers', 'x', 'y', 'delivery_mode', 'scope', 'target'],
    required: ['key'],
    deliveryMode: true,
    input: true,
    requiresPid: true,
  },
  hotkey: {
    allowed: ['session', 'pid', 'window_id', 'element_index', 'element_token', 'snapshot_id',
      'keys', 'x', 'y', 'delivery_mode', 'scope', 'target'],
    required: ['keys'],
    deliveryMode: true,
    input: true,
    requiresPid: true,
  },
  scroll: {
    allowed: ['session', 'pid', 'window_id', 'element_index', 'element_token', 'snapshot_id',
      'direction', 'amount', 'by', 'x', 'y', 'delivery_mode', 'scope', 'target'],
    required: ['direction'],
    deliveryMode: true,
    input: true,
    requiresPid: true,
  },

  // --- bound, non-`delivery_mode` actions ----------------------------------
  move_cursor: {
    // 0.21.0: window scope moves only the agent overlay; desktop scope moves
    // the real OS pointer. Only the explicitly window-bound overlay form is
    // reachable, enforced below.
    allowed: ['session', 'scope', 'target', 'x', 'y'],
    withheld: ['cursor_id'],
    required: ['scope', 'target', 'x', 'y'],
  },
  invoke_menu: {
    // Pure accessibility resolution; the driver never falls back to pixels and
    // publishes no `delivery_mode`. Do not invent one.
    allowed: ['session', 'pid', 'window_id', 'path'],
    required: ['pid', 'window_id', 'path'],
    requiresPid: true,
    requiresWindowId: true,
  },
  set_window_frame: {
    allowed: ['session', 'pid', 'window_id', 'x', 'y', 'width', 'height'],
    required: ['pid', 'window_id', 'x', 'y', 'width', 'height'],
    requiresPid: true,
    requiresWindowId: true,
  },
  launch_app: {
    // `additional_arguments` is arbitrary argv and `webkit_inspector_port`
    // opens an inspector server; neither is needed by the managed path.
    allowed: ['session', 'bundle_id', 'name', 'urls', 'creates_new_application_instance'],
    withheld: ['additional_arguments', 'webkit_inspector_port'],
  },
} as const;

export function cuaToolPolicy(tool: string): CuaToolPolicy | undefined {
  return Object.hasOwn(CUA_TOOL_POLICIES, tool) ? CUA_TOOL_POLICIES[tool] : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** `{ kind: 'window', pid, window_id }` per the shared driver target schema. */
function readWindowTarget(value: unknown, tool: string): { pid: number; windowId: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) deny(`${tool} target must be a window target object.`);
  const target = value as Record<string, unknown>;
  if (target.kind === 'desktop') deny(`${tool} rejects desktop-scoped targets on the background-only managed path.`);
  if (target.kind !== 'window') deny(`${tool} target kind is not a documented window target.`);
  const pid = positiveInteger(target.pid);
  const windowId = positiveInteger(target.window_id);
  if (pid === undefined || windowId === undefined) {
    deny(`${tool} window target requires a valid pid and window_id.`);
  }
  return { pid, windowId };
}

export type GuardedCuaCall = {
  tool: string;
  arguments: Record<string, unknown>;
};

/**
 * Authoritative per-tool validation. Returns the canonicalized argument record
 * that may be sent to the driver, or throws {@link CuaPolicyError}.
 *
 * The returned record is rebuilt from reviewed keys only — the caller's object
 * is never forwarded by reference.
 */
export function guardCuaCall(tool: string, args: Record<string, unknown>): GuardedCuaCall {
  const policy = cuaToolPolicy(tool);
  if (!policy) deny(`${tool} is not a reviewed CUA Driver capability.`);

  // Security-semantic checks run first so a denial always reports the most
  // specific reason, even for a tool whose schema omits the field entirely.
  if (args.delivery_mode !== undefined && !policy.deliveryMode) {
    deny(`${tool} does not publish delivery_mode in CUA Driver ${CUA_DRIVER_SCHEMA_VERSION}.`);
  }
  if (args.delivery_mode === 'foreground') {
    deny(`${tool} foreground delivery is denied: the managed computer path is background-only.`);
  }
  if (args.scope === 'desktop') {
    deny(tool === 'move_cursor'
      ? 'move_cursor with scope "desktop" moves the real OS pointer and is denied on the managed path.'
      : `${tool} with scope "desktop" delivers unbound whole-desktop input and is denied.`);
  }

  for (const key of Object.keys(args)) {
    if (policy.withheld?.includes(key)) {
      deny(`${tool} argument "${key}" is withheld from the managed computer path.`);
    }
    if (!policy.allowed.includes(key)) {
      deny(`${tool} argument "${key}" is not a reviewed CUA Driver ${CUA_DRIVER_SCHEMA_VERSION} argument.`);
    }
  }
  for (const key of policy.required ?? []) {
    if (args[key] === undefined) deny(`${tool} requires the "${key}" argument.`);
  }

  const guarded: Record<string, unknown> = {};
  for (const key of policy.allowed) {
    if (args[key] !== undefined) guarded[key] = args[key];
  }

  if (guarded.session !== undefined
    && (typeof guarded.session !== 'string' || !guarded.session || guarded.session.length > 128)) {
    deny(`${tool} session label is malformed.`);
  }

  const target = readWindowTarget(guarded.target, tool);
  const pid = positiveInteger(guarded.pid);
  const windowId = positiveInteger(guarded.window_id);
  if (guarded.pid !== undefined && pid === undefined) deny(`${tool} pid is malformed.`);
  if (guarded.window_id !== undefined && windowId === undefined) deny(`${tool} window_id is malformed.`);
  if (target && pid !== undefined && target.pid !== pid) {
    deny(`${tool} target pid does not match the requested pid.`);
  }
  if (target && windowId !== undefined && target.windowId !== windowId) {
    deny(`${tool} target window_id does not match the requested window_id.`);
  }
  if (policy.requiresPid && pid === undefined && target === undefined) {
    deny(`${tool} requires a bound target pid.`);
  }
  if (policy.requiresWindowId && windowId === undefined && target === undefined) {
    deny(`${tool} requires a bound target window_id.`);
  }

  // ---- scope: no desktop-scoped delivery on the managed path ---------------
  if (guarded.scope !== undefined && guarded.scope !== 'window') {
    deny(`${tool} scope is not a documented value.`);
  }

  // ---- delivery_mode: background only --------------------------------------
  if (policy.deliveryMode) {
    const mode = guarded.delivery_mode;
    if (mode === undefined) {
      // Documented driver default is already background; make it explicit so
      // the request never depends on an unstated default.
      guarded.delivery_mode = 'background';
    } else if (mode !== 'background') {
      deny(`${tool} delivery_mode "${String(mode)}" is not a documented value.`);
    }
  }

  // ---- input tools must be bound to a window, never the desktop ------------
  if (policy.input) {
    guarded.scope = 'window';
    if (pid === undefined && target === undefined) {
      deny(`${tool} requires a bound pid; unbound input delivery is denied.`);
    }
  }

  // ---- snapshot / element binding ------------------------------------------
  if (guarded.element_index !== undefined) {
    if (positiveInteger(guarded.element_index) === undefined && guarded.element_index !== 0) {
      deny(`${tool} element_index is malformed.`);
    }
    if (typeof guarded.snapshot_id !== 'string') {
      deny(`${tool} element_index requires the matching snapshot_id from get_window_state.`);
    }
    if (windowId === undefined && target === undefined) {
      deny(`${tool} element_index requires window_id.`);
    }
  }
  if (guarded.snapshot_id !== undefined
    && (typeof guarded.snapshot_id !== 'string' || !/^s[0-9a-f]{8}$/u.test(guarded.snapshot_id))) {
    deny(`${tool} snapshot_id does not match the documented driver format.`);
  }
  if (guarded.element_token !== undefined
    && (typeof guarded.element_token !== 'string' || !guarded.element_token || guarded.element_token.length > 512)) {
    deny(`${tool} element_token is malformed.`);
  }

  // ---- move_cursor: overlay only, explicitly window-bound ------------------
  if (tool === 'move_cursor') {
    if (guarded.scope !== 'window') {
      deny('move_cursor requires an explicit window scope on the managed path.');
    }
    if (!target) {
      deny('move_cursor requires an explicit window-bound target; unbound cursor movement is denied.');
    }
  }

  if (tool === 'launch_app' && !guarded.bundle_id && !guarded.name) {
    deny('launch_app requires a resolvable bundle_id or name.');
  }

  return { tool, arguments: guarded };
}

/* -------------------------------------------------------------------------- */
/* Application-identity requirement                                           */
/* -------------------------------------------------------------------------- */

/**
 * Tools that are read-only discovery reads and therefore carry no application
 * grant requirement. `move_cursor` is deliberately NOT here: 0.21.0 can move
 * the physical pointer, so it is an application-bound action.
 */
const CUA_DISCOVERY_TOOLS: ReadonlySet<string> = new Set([
  'start_session', 'end_session', 'list_apps', 'get_accessibility_tree',
]);

export function isCuaDiscoveryTool(tool: string): boolean {
  return CUA_DISCOVERY_TOOLS.has(tool);
}

/**
 * Whether this exact call must be bound to an approved application before it
 * may execute. Shared by `authorizeComputer` (which resolves and prompts) and
 * `callComputer` (which enforces), so the two can never disagree.
 */
export function requiresApplicationIdentity(tool: string, args: Record<string, unknown>): boolean {
  if (tool === 'launch_app') return true;
  if (readRequestedPid(args) !== undefined || readRequestedWindowId(args) !== undefined) return true;
  if (tool === 'list_windows') return args.pid !== undefined;
  return !CUA_DISCOVERY_TOOLS.has(tool);
}

/** `pid` from either the flat field or the shared `target` descriptor. */
export function readRequestedPid(args: Record<string, unknown>): number | undefined {
  const flat = positiveInteger(args.pid);
  if (flat !== undefined) return flat;
  const target = args.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  return positiveInteger((target as Record<string, unknown>).pid);
}

/** `window_id` from either the flat field or the shared `target` descriptor. */
export function readRequestedWindowId(args: Record<string, unknown>): number | undefined {
  const flat = positiveInteger(args.window_id);
  if (flat !== undefined) return flat;
  const target = args.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  return positiveInteger((target as Record<string, unknown>).window_id);
}
