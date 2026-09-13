import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CuaPolicyError,
  guardCuaCall,
  isCuaDiscoveryTool,
  isCuaDriverSchemaSupported,
  parseCuaPermissionsJson,
  parseCuaPermissionsText,
  readCuaPermissions,
  requiresApplicationIdentity,
} from './cua-capability.js';

const DENIED = { name: 'CuaPolicyError' };

function denies(tool: string, args: Record<string, unknown>, match?: RegExp): void {
  assert.throws(() => guardCuaCall(tool, args), match ? { ...DENIED, message: match } : DENIED);
}

function allows(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  return guardCuaCall(tool, args).arguments;
}

/* -------------------------------------------------------------------------- */
/* Permissions                                                                */
/* -------------------------------------------------------------------------- */

/** Verbatim payload captured from `cua-driver permissions status --json` @ 0.21.0. */
const REAL_STRUCTURED = JSON.stringify({
  accessibility: true,
  direct_capture_error: null,
  direct_capture_status: 'not_checked',
  screen_recording: true,
  screen_recording_capturable: null,
  source: {
    attribution: 'driver-daemon',
    bundle_id: 'com.trycua.driver',
    disclaim_env: false,
    executable: '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
    pid: 6852,
    responsible_ppid: 1,
  },
});

/** Verbatim text output captured from `cua-driver permissions status` @ 0.21.0. */
const REAL_TEXT = [
  'Accessibility:    \u2705 granted',
  'Screen Recording: \u2705 granted',
  'Direct Capture:     \u2753 not checked (status is read-only; run `cua-driver permissions grant`)',
  'Source: driver-daemon',
].join('\n');

test('structured permission payload reports explicit grants', () => {
  const report = parseCuaPermissionsJson(REAL_STRUCTURED);
  assert.deepEqual(report, {
    accessibility: true,
    screenRecording: true,
    source: 'structured',
    attribution: 'driver-daemon',
  });
});

test('structured permission payload reports explicit denials as false', () => {
  const report = parseCuaPermissionsJson(JSON.stringify({
    accessibility: false, screen_recording: false, source: { attribution: 'driver-daemon' },
  }));
  assert.equal(report?.accessibility, false);
  assert.equal(report?.screenRecording, false);
});

test('structured permission payload never turns unknown or missing fields into a grant', () => {
  const nulled = parseCuaPermissionsJson(JSON.stringify({
    accessibility: null, screen_recording: 'granted', source: { attribution: 'driver-daemon' },
  }));
  assert.equal(nulled?.accessibility, undefined);
  assert.equal(nulled?.screenRecording, undefined);

  const missing = parseCuaPermissionsJson(JSON.stringify({
    accessibility: true, source: { attribution: 'driver-daemon' },
  }));
  assert.equal(missing?.accessibility, true);
  assert.equal(missing?.screenRecording, undefined, 'a missing field is unknown, not granted');
});

test('structured permission payload fails closed when the daemon did not answer', () => {
  // The CLI documents that with no running daemon the answer is `unknown`
  // rather than the caller process's own grants.
  for (const source of [undefined, {}, { attribution: 'process-self' }, { attribution: 'unknown' }]) {
    const report = parseCuaPermissionsJson(JSON.stringify({
      accessibility: true, screen_recording: true, ...(source ? { source } : {}),
    }));
    assert.equal(report?.accessibility, undefined, `attribution ${JSON.stringify(source)} must not grant`);
    assert.equal(report?.screenRecording, undefined);
  }
});

test('malformed or unrelated JSON is not treated as a permission payload', () => {
  assert.equal(parseCuaPermissionsJson('{ not json'), null);
  assert.equal(parseCuaPermissionsJson('[]'), null);
  assert.equal(parseCuaPermissionsJson('null'), null);
  assert.equal(parseCuaPermissionsJson(JSON.stringify({ version: '0.21.0' })), null);
});

test('legacy text fallback reads the real 0.21.0 human output', () => {
  const report = parseCuaPermissionsText(REAL_TEXT);
  assert.equal(report.accessibility, true);
  assert.equal(report.screenRecording, true);
  assert.equal(report.source, 'legacy-text');
});

test('AUDIT REGRESSION: legacy fallback never reads a negated state as granted', () => {
  // These are the exact strings the audit found being parsed as `true`.
  for (const line of [
    'Accessibility: not granted',
    'Accessibility: unauthorized',
    'Accessibility: unauthorised',
    'Accessibility: denied',
    'Accessibility: disabled',
    'Accessibility: \u274c not granted',
    'Accessibility: not authorized',
  ]) {
    assert.equal(parseCuaPermissionsText(line).accessibility, false, line);
  }
});

test('legacy fallback keeps unknown, empty and unexpected output unknown', () => {
  for (const line of [
    'Accessibility: unknown',
    'Accessibility: not checked',
    'Accessibility:',
    'Accessibility: quantum superposition',
    'Accessibility: never granted',
    'Accessibility: partially granted',
    'Screen Recording: granted-with-restrictions',
    '',
    'totally unrelated output',
  ]) {
    const report = parseCuaPermissionsText(line);
    assert.equal(report.accessibility, undefined, line);
    assert.equal(report.screenRecording, undefined, line);
  }
});

test('legacy fallback fails closed on an untrusted attribution line', () => {
  const report = parseCuaPermissionsText('Accessibility: granted\nSource: process-self');
  assert.equal(report.accessibility, undefined);
  assert.equal(report.attribution, 'process-self');
});

test('a failed inspection can only preserve denials, never produce a grant', () => {
  assert.deepEqual(readCuaPermissions({ ok: false, output: '' }), {
    accessibility: undefined, screenRecording: undefined, source: 'none',
  });
  assert.equal(readCuaPermissions({ ok: false, output: REAL_STRUCTURED }).accessibility, undefined);
  const denial = readCuaPermissions({
    ok: false,
    output: JSON.stringify({ accessibility: false, screen_recording: true, source: { attribution: 'driver-daemon' } }),
  });
  assert.equal(denial.accessibility, false);
  assert.equal(denial.screenRecording, undefined);
});

test('readCuaPermissions prefers the structured payload and falls back to bounded text', () => {
  assert.equal(readCuaPermissions({ ok: true, output: REAL_STRUCTURED }).source, 'structured');
  assert.equal(readCuaPermissions({ ok: true, output: REAL_TEXT }).source, 'legacy-text');
  assert.equal(readCuaPermissions({ ok: true, output: '' }).source, 'none');
});

test('driver schema support is pinned to the reviewed release line', () => {
  assert.equal(isCuaDriverSchemaSupported('cua-driver 0.21.0'), true);
  assert.equal(isCuaDriverSchemaSupported('0.21.4'), true);
  assert.equal(isCuaDriverSchemaSupported('cua-driver 0.22.0'), false);
  assert.equal(isCuaDriverSchemaSupported(undefined), false);
});

/* -------------------------------------------------------------------------- */
/* Background input policy                                                    */
/* -------------------------------------------------------------------------- */

const BOUND = { pid: 42, window_id: 7 };

test('omitted delivery_mode is canonicalized to background on every input tool', () => {
  for (const tool of ['click', 'type_text', 'press_key', 'hotkey', 'scroll'] as const) {
    const required = {
      click: {}, type_text: { text: 'hi' }, press_key: { key: 'return' },
      hotkey: { keys: ['cmd', 'c'] }, scroll: { direction: 'down' },
    }[tool];
    const guarded = allows(tool, { ...BOUND, ...required });
    assert.equal(guarded.delivery_mode, 'background', tool);
    assert.equal(guarded.scope, 'window', tool);
  }
});

test('explicit background delivery is accepted', () => {
  assert.equal(allows('click', { ...BOUND, delivery_mode: 'background' }).delivery_mode, 'background');
});

const INPUT_REQUIRED = {
  click: {}, type_text: { text: 'x' }, press_key: { key: 'a' },
  hotkey: { keys: ['cmd', 'c'] }, scroll: { direction: 'down' },
} as const;

test('explicit foreground delivery is rejected on every input tool', () => {
  for (const [tool, required] of Object.entries(INPUT_REQUIRED)) {
    denies(tool, { ...BOUND, ...required, delivery_mode: 'foreground' }, /foreground delivery is denied/u);
  }
});

test('foreground delivery is rejected before any binding complaint', () => {
  // An unbound foreground request must report the foreground denial, not a
  // missing pid, so the reason surfaced to the operator is the real one.
  denies('click', { delivery_mode: 'foreground' }, /foreground delivery is denied/u);
});

test('an undocumented delivery_mode value is rejected rather than coerced', () => {
  denies('click', { ...BOUND, delivery_mode: 'auto' }, /not a documented value/u);
  denies('click', { ...BOUND, delivery_mode: true as unknown as string }, /not a documented value/u);
});

test('desktop-scoped input delivery is rejected', () => {
  for (const [tool, required] of Object.entries(INPUT_REQUIRED)) {
    denies(tool, { ...required, scope: 'desktop' }, /unbound whole-desktop input/u);
    denies(tool, { ...BOUND, ...required, scope: 'desktop' }, /unbound whole-desktop input/u);
  }
  // Tools whose schema has no scope field must also report the real reason.
  denies('invoke_menu', { pid: 42, window_id: 7, path: ['File'], scope: 'desktop' }, /unbound whole-desktop input/u);
});

test('a pid combined with desktop input scope is still rejected', () => {
  denies('press_key', { ...BOUND, key: 'return', scope: 'desktop' }, /unbound whole-desktop input/u);
  denies('click', { ...BOUND, scope: 'desktop' }, /unbound whole-desktop input/u);
});

test('a desktop target descriptor is rejected on input tools', () => {
  denies('click', { target: { kind: 'desktop', display_id: 'primary' } }, /desktop-scoped targets/u);
});

test('unbound input with no pid and no target is rejected', () => {
  denies('click', {}, /bound target pid/u);
  denies('press_key', { key: 'return' }, /bound target pid/u);
  denies('scroll', { direction: 'down' }, /bound target pid/u);
});

test('a target that disagrees with the requested pid or window is rejected', () => {
  denies('click', { pid: 42, target: { kind: 'window', pid: 99, window_id: 7 } }, /target pid does not match/u);
  denies('click', { ...BOUND, target: { kind: 'window', pid: 42, window_id: 9 } }, /target window_id does not match/u);
  const agreed = allows('click', { ...BOUND, target: { kind: 'window', pid: 42, window_id: 7 } });
  assert.deepEqual(agreed.target, { kind: 'window', pid: 42, window_id: 7 });
});

test('malformed pid and window identifiers are rejected', () => {
  denies('click', { pid: 0 }, /pid is malformed/u);
  denies('click', { pid: -1 }, /pid is malformed/u);
  denies('click', { pid: 1.5 }, /pid is malformed/u);
  denies('click', { pid: '42' }, /pid is malformed/u);
  denies('click', { pid: 42, window_id: 0 }, /window_id is malformed/u);
  denies('click', { target: { kind: 'window', pid: 42 } }, /requires a valid pid and window_id/u);
});

test('element_index without its snapshot_id is rejected', () => {
  denies('click', { ...BOUND, element_index: 3 }, /requires the matching snapshot_id/u);
  const guarded = allows('click', { ...BOUND, element_index: 3, snapshot_id: 's0a1b2c3d' });
  assert.equal(guarded.snapshot_id, 's0a1b2c3d');
});

test('a snapshot_id that does not match the documented driver format is rejected', () => {
  denies('click', { ...BOUND, element_index: 3, snapshot_id: 'snapshot-1' }, /documented driver format/u);
  denies('click', { ...BOUND, element_index: 3, snapshot_id: 'sABCDEF12' }, /documented driver format/u);
});

test('unknown tools and unknown arguments fail closed', () => {
  denies('bring_to_front', { pid: 42 }, /not a reviewed CUA Driver capability/u);
  denies('kill_app', { pid: 42 }, /not a reviewed CUA Driver capability/u);
  denies('click', { ...BOUND, future_delivery_hint: 'foreground' }, /not a reviewed CUA Driver 0\.21\.0 argument/u);
  denies('list_apps', { include_hidden: true }, /not a reviewed CUA Driver 0\.21\.0 argument/u);
});

test('security-relevant driver arguments are withheld rather than forwarded', () => {
  denies('click', { ...BOUND, debug_image_out: '/tmp/x.png' }, /withheld/u);
  // A modified click is documented as requiring foreground delivery.
  denies('click', { ...BOUND, modifier: ['cmd'] }, /withheld/u);
  denies('get_window_state', { ...BOUND, screenshot_out_file: '/tmp/x.png' }, /withheld/u);
  denies('get_window_state', { ...BOUND, capture_mode: 'ax' }, /withheld/u);
  denies('launch_app', { bundle_id: 'com.apple.Terminal', additional_arguments: ['-c', 'rm -rf /'] }, /withheld/u);
  denies('launch_app', { bundle_id: 'com.example.App', webkit_inspector_port: 9222 }, /withheld/u);
});

test('the guarded record is rebuilt from reviewed keys only', () => {
  const args = { ...BOUND, text: 'hello', delay_ms: 10 };
  const guarded = guardCuaCall('type_text', args);
  assert.notEqual(guarded.arguments, args);
  assert.deepEqual(guarded.arguments, {
    pid: 42, window_id: 7, text: 'hello', delay_ms: 10, delivery_mode: 'background', scope: 'window',
  });
});

/* -------------------------------------------------------------------------- */
/* move_cursor                                                                */
/* -------------------------------------------------------------------------- */

test('move_cursor has no discovery exemption', () => {
  assert.equal(isCuaDiscoveryTool('move_cursor'), false);
  assert.equal(requiresApplicationIdentity('move_cursor', { scope: 'window', target: { kind: 'window', pid: 42, window_id: 7 }, x: 1, y: 2 }), true);
  assert.equal(requiresApplicationIdentity('move_cursor', {}), true);
});

test('move_cursor that could reach the physical pointer is rejected', () => {
  denies('move_cursor', { scope: 'desktop', target: { kind: 'window', pid: 42, window_id: 7 }, x: 1, y: 2 },
    /moves the real OS pointer/u);
  denies('move_cursor', { scope: 'window', target: { kind: 'desktop', display_id: 'primary' }, x: 1, y: 2 },
    /desktop-scoped targets/u);
});

test('move_cursor is rejected unless it is explicitly window-scoped and window-bound', () => {
  denies('move_cursor', { x: 1, y: 2 }, /requires the "scope" argument/u);
  denies('move_cursor', { scope: 'window', x: 1, y: 2 }, /requires the "target" argument/u);
  denies('move_cursor', { scope: 'window', target: null, x: 1, y: 2 }, /explicit window-bound target/u);
  denies('move_cursor', { scope: 'window', target: { kind: 'window', pid: 42, window_id: 7 } }, /requires the "x" argument/u);
  // `cursor_id` would let a call address a cursor this session does not own.
  denies('move_cursor', { scope: 'window', target: { kind: 'window', pid: 42, window_id: 7 }, x: 1, y: 2, cursor_id: 'other' }, /withheld/u);
});

test('the fully bound overlay form of move_cursor is accepted', () => {
  const guarded = allows('move_cursor', {
    scope: 'window', target: { kind: 'window', pid: 42, window_id: 7 }, x: 10, y: 20,
  });
  assert.equal(guarded.delivery_mode, undefined, 'move_cursor publishes no delivery_mode in 0.21.0');
  assert.deepEqual(guarded, { scope: 'window', target: { kind: 'window', pid: 42, window_id: 7 }, x: 10, y: 20 });
});

/* -------------------------------------------------------------------------- */
/* Other tools                                                                */
/* -------------------------------------------------------------------------- */

test('invoke_menu keeps its documented pure-AX binding and never requests delivery', () => {
  const guarded = allows('invoke_menu', { pid: 42, window_id: 7, path: ['File', 'Save'] });
  assert.equal(guarded.delivery_mode, undefined);
  assert.deepEqual(guarded, { pid: 42, window_id: 7, path: ['File', 'Save'] });
  denies('invoke_menu', { pid: 42, window_id: 7, path: ['File'], delivery_mode: 'foreground' },
    /does not publish delivery_mode/u);
  denies('invoke_menu', { pid: 42, window_id: 7, path: ['File'], delivery_mode: 'background' },
    /does not publish delivery_mode/u);
  denies('invoke_menu', { pid: 42, path: ['File'] }, /requires the "window_id" argument/u);
});

test('set_window_frame requires its documented binding and grants no input authority', () => {
  assert.deepEqual(
    allows('set_window_frame', { pid: 42, window_id: 7, x: 0, y: 0, width: 800, height: 600 }),
    { pid: 42, window_id: 7, x: 0, y: 0, width: 800, height: 600 },
  );
  denies('set_window_frame', { pid: 42, x: 0, y: 0, width: 8, height: 6 }, /requires the "window_id" argument/u);
  denies('set_window_frame', { pid: 42, window_id: 7, x: 0, y: 0, width: 8, height: 6, delivery_mode: 'foreground' },
    /does not publish delivery_mode/u);
});

test('launch_app keeps its documented background launch and needs a resolvable target', () => {
  assert.deepEqual(allows('launch_app', { bundle_id: 'com.apple.TextEdit' }), { bundle_id: 'com.apple.TextEdit' });
  assert.deepEqual(allows('launch_app', { name: 'TextEdit', urls: ['/tmp'] }), { name: 'TextEdit', urls: ['/tmp'] });
  denies('launch_app', {}, /resolvable bundle_id or name/u);
  denies('launch_app', { bundle_id: 'com.apple.TextEdit', delivery_mode: 'foreground' }, /does not publish delivery_mode/u);
});

test('read-only discovery reads stay available', () => {
  assert.deepEqual(allows('list_apps', {}), {});
  assert.deepEqual(allows('get_accessibility_tree', {}), {});
  assert.deepEqual(allows('list_windows', { pid: 42, on_screen_only: true }), { pid: 42, on_screen_only: true });
  assert.deepEqual(
    allows('get_window_state', { pid: 42, window_id: 7, include_screenshot: false }),
    { pid: 42, window_id: 7, include_screenshot: false },
  );
  denies('get_window_state', { pid: 42 }, /requires the "window_id" argument/u);
});

test('session labels are validated but lifecycle calls stay unchanged', () => {
  assert.deepEqual(allows('start_session', { session: 'gajae-abc' }), { session: 'gajae-abc' });
  assert.deepEqual(allows('end_session', { session: 'gajae-abc' }), { session: 'gajae-abc' });
  denies('start_session', { session: '' }, /session label is malformed/u);
  denies('start_session', { session: 'x'.repeat(129) }, /session label is malformed/u);
  denies('start_session', { capture_scope: 'desktop' }, /not a reviewed CUA Driver 0\.21\.0 argument/u);
});

test('application identity requirements match the authorize path', () => {
  assert.equal(requiresApplicationIdentity('list_apps', {}), false);
  assert.equal(requiresApplicationIdentity('get_accessibility_tree', {}), false);
  assert.equal(requiresApplicationIdentity('start_session', {}), false);
  assert.equal(requiresApplicationIdentity('end_session', {}), false);
  assert.equal(requiresApplicationIdentity('list_windows', {}), false);
  assert.equal(requiresApplicationIdentity('list_windows', { pid: 42 }), true);
  assert.equal(requiresApplicationIdentity('launch_app', {}), true);
  assert.equal(requiresApplicationIdentity('click', {}), true);
  assert.equal(requiresApplicationIdentity('get_window_state', { window_id: 7 }), true);
  assert.equal(requiresApplicationIdentity('click', { target: { kind: 'window', pid: 42, window_id: 7 } }), true);
});

test('policy denials are typed so callers can distinguish them from driver failures', () => {
  assert.throws(() => guardCuaCall('click', { ...BOUND, delivery_mode: 'foreground' }), (error: unknown) => {
    assert.ok(error instanceof CuaPolicyError);
    assert.match((error as Error).message, /^cua_policy_denied: /u);
    return true;
  });
});
