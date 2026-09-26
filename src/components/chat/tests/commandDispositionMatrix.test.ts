import assert from 'node:assert/strict';
import test from 'node:test';

import { TUI_ONLY_COMMAND_HINTS } from '../appUiCommands';
import {
  classifyCommandInput,
  isAutoSendable,
  type CommandDisposition,
} from '../commandDispatchPolicy';

/*
 * The frozen command disposition matrix.
 *
 * Every slash form a user can type has exactly one app-owned answer: run a
 * local UI action, print a local notice, or forward it to the runtime, which
 * runs it at once as the GJC CLI does. Which one it gets is the app's contract; what the runtime then prints
 * for a malformed argument is the runtime's business and is not asserted here.
 *
 * This matrix exists because the routing bugs it pins were all invisible at the
 * command-name level. `/move`, `/models`, `/bg`, `/quit`, `/contribution-prep`
 * and bare `help` each reached the model as prose while their names looked
 * handled. Looping over the
 * registries — as the neighbouring tests do — cannot catch any of those,
 * because a form that falls out of a registry silently falls out of the loop
 * with it. Rows are therefore written out one by one, and a new command has to
 * be added here deliberately.
 *
 * Row ids come from the reviewed inventory in
 * `.gjc/.../deep-interview-command-e2e-defect-loop` so a row can be traced back
 * to the branch it was derived from. Groups A-G are that inventory's grouping.
 */

type Kind = CommandDisposition['kind'];

/** [row id, exact typed text, expected disposition] */
type Row = readonly [string, string, Kind];

const GROUP_A: readonly Row[] = [
  // Runtime commands and aliases the app answers itself. Every one of these
  // reached the model as prose before the app claimed it.
  ['A01', '/move', 'notice'],
  ['A02', '/move sibling', 'notice'],
  ['A03', '/move /nonexistent-e2e', 'notice'],
  ['A04', '/models', 'app-action'],
  ['A05', '/models gpt-5', 'command'],
  ['A06', '/bg', 'notice'],
  ['A07', '/bg now', 'notice'],
  ['A08', '/quit', 'notice'],
  ['A09', '/quit now', 'notice'],
  ['A10', '/contribution-prep', 'command'],
  ['A11', '/contribution-prep focus e2e', 'command'],
  ['A12', '/help', 'notice'],
  ['A13', 'help', 'notice'],
  ['A14', '/help extra e2e-arg', 'notice'],
  ['A15', '/notacommand-e2e', 'command'],
];

const GROUP_B: readonly Row[] = [
  // TUI-only commands, bare and with arguments. Arguments must not smuggle one
  // past the notice.
  ['B01', '/retry', 'notice'],
  ['B02', '/retry e2e-arg', 'notice'],
  ['B03', '/goal', 'notice'],
  ['B04', '/goal set e2e-arg', 'notice'],
  ['B05', '/agents', 'notice'],
  ['B06', '/agents e2e-arg', 'notice'],
  ['B07', '/monitors', 'notice'],
  ['B08', '/monitors e2e-arg', 'notice'],
  ['B09', '/tree', 'notice'],
  ['B10', '/tree e2e-arg', 'notice'],
  ['B11', '/background', 'notice'],
  ['B12', '/background e2e-arg', 'notice'],
  ['B13', '/debug', 'notice'],
  ['B14', '/debug e2e-arg', 'notice'],
  ['B15', '/copy', 'notice'],
  ['B16', '/copy e2e-arg', 'notice'],
  ['B17', '/btw', 'notice'],
  ['B18', '/btw e2e-arg', 'notice'],
  ['B19', '/drop', 'notice'],
  ['B20', '/drop e2e-arg', 'notice'],
  ['B21', '/hotkeys', 'notice'],
  ['B22', '/hotkeys e2e-arg', 'notice'],
  ['B23', '/theme', 'notice'],
  ['B24', '/theme dark', 'notice'],
  ['B25', '/pet', 'notice'],
  ['B26', '/pet e2e-arg', 'notice'],
  ['B27', '/exit', 'notice'],
  ['B28', '/exit now', 'notice'],
];

const GROUP_C: readonly Row[] = [
  // App UI commands, plus every /model branch. /model is the only entry with
  // `interceptWithArgs: false`, so C09 opens the picker and C10-C20 belong to
  // the runtime.
  ['C01', '/resume', 'app-action'],
  ['C02', '/resume e2e-arg', 'app-action'],
  ['C03', '/sessions', 'app-action'],
  ['C04', '/sessions e2e-arg', 'app-action'],
  ['C05', '/new', 'app-action'],
  ['C06', '/new e2e-arg', 'app-action'],
  ['C07', '/settings', 'app-action'],
  ['C08', '/settings e2e-arg', 'app-action'],
  ['C09', '/model', 'app-action'],
  ['C10', '/model e2e-model', 'command'],
  ['C11', '/model executor e2e-model', 'command'],
  ['C12', '/model e2e-not-a-model', 'command'],
  ['C13', '/model roles', 'command'],
  ['C14', '/model assignments', 'command'],
  ['C15', '/model executor', 'command'],
  ['C16', '/model assign executor e2e-model', 'command'],
  ['C17', '/model set architect e2e-model', 'command'],
  ['C18', '/model all-role-agents e2e-model', 'command'],
  ['C19', '/model all-targets e2e-model', 'command'],
  ['C20', '/model planner e2e-not-a-model', 'command'],
];

const GROUP_D: readonly Row[] = [
  // Runtime text forms, including every argument branch the handlers carry.
  // A bogus verb reaches the runtime too, which answers it as the CLI would.
  ['D01', '/dump', 'command'],
  ['D02', '/session', 'command'],
  ['D03', '/session info', 'command'],
  ['D04', '/session e2e-bogus', 'command'],
  ['D05', '/jobs', 'command'],
  ['D06', '/transcript', 'notice'],
  ['D07', '/context', 'command'],
  ['D08', '/usage', 'command'],
  ['D09', '/changelog', 'command'],
  ['D10', '/changelog full', 'command'],
  ['D11', '/changelog --full', 'command'],
  ['D12', '/changelog e2e-bogus', 'command'],
  ['D13', '/tools', 'command'],
  ['D14', '/notify', 'command'],
  ['D15', '/notify status', 'command'],
  ['D16', '/notify health', 'command'],
  ['D17', '/notify setup', 'command'],
  ['D18', '/notify e2e-bogus', 'command'],
  // The one /notify form upstream returns as a residual prompt. The app runs
  // its own notification stack, so it answers instead of letting it reach the
  // model as prose.
  ['D19', '/notify on', 'notice'],
  ['D20', '/notify off', 'notice'],
  ['D21', '/notify test', 'command'],
  ['D22', '/notify test e2e message', 'command'],
  ['D23', '/notify recovery', 'command'],
  ['D24', '/effort', 'command'],
  ['D25', '/effort e2e-bogus', 'command'],
  ['D26', '/effort medium high', 'command'],
  ['D27', '/effort medium', 'command'],
  ['D28', '/effort inherit', 'command'],
  ['D29', '/fast status', 'command'],
  ['D30', '/fast', 'command'],
  ['D31', '/fast toggle', 'command'],
  ['D32', '/fast on', 'command'],
  ['D33', '/fast off', 'command'],
  ['D34', '/fast e2e-bogus', 'command'],
  ['D35', '/provider', 'command'],
  ['D36', '/provider help', 'command'],
  ['D37', '/provider login', 'command'],
  ['D38', '/provider login anthropic', 'command'],
  ['D39', '/provider e2e-bogus', 'command'],
  // `/provider add` runs as typed; the runtime parser owns its arguments.
  ['D40', '/provider add', 'command'],
  ['D41', '/provider add --compat openai', 'command'],
  ['D42', '/provider add --api-key sk-e2e-not-real', 'command'],
  ['D43', '/provider add --preset glm', 'command'],
  ['D44', '/provider add glm', 'command'],
  ['D45', '/provider add zai', 'command'],
  ['D46', '/provider add --compat openai --provider e2e-local --base-url http://127.0.0.1:9/ --api-key-env E2E_KEY --model e2e-model', 'command'],
  ['D47', '/ssh', 'command'],
  ['D48', '/ssh help', 'command'],
  ['D49', '/ssh list', 'command'],
  ['D50', '/ssh e2e-bogus', 'command'],
  // Same rule as /provider add: the verb decides, not the arguments.
  ['D51', '/ssh add', 'command'],
  ['D52', '/ssh add --host 127.0.0.1', 'command'],
  ['D53', '/ssh add e2e-host', 'command'],
  ['D54', '/ssh add e2e-host --bogus x', 'command'],
  ['D55', '/ssh add e2e-host e2e-extra --host 127.0.0.1', 'command'],
  ['D56', '/ssh add e2e-host --host', 'command'],
  ['D57', '/ssh add e2e-host --host 127.0.0.1 --user', 'command'],
  ['D58', '/ssh add e2e-host --host 127.0.0.1 --port', 'command'],
  ['D59', '/ssh add e2e-host --host 127.0.0.1 --port 22oops', 'command'],
  ['D60', '/ssh add e2e-host --host 127.0.0.1 --port 70000', 'command'],
  ['D61', '/ssh add e2e-host --host 127.0.0.1 --key', 'command'],
  ['D62', '/ssh add e2e-host --host 127.0.0.1 --scope', 'command'],
  ['D63', '/ssh add e2e-host --host 127.0.0.1 --scope e2e-bogus', 'command'],
  ['D64', '/ssh remove', 'command'],
  ['D65', '/ssh rm', 'command'],
  ['D66', '/ssh remove --scope user', 'command'],
  ['D67', '/ssh remove e2e-host --bogus x', 'command'],
  ['D68', '/ssh remove e2e-host --scope', 'command'],
  ['D69', '/ssh remove e2e-host --scope e2e-bogus', 'command'],
  ['D70', '/memory', 'command'],
  ['D71', '/memory view', 'command'],
  ['D72', '/memory e2e-bogus', 'command'],
  ['D73', '/memory mm', 'command'],
  ['D74', '/memory mm list', 'command'],
  ['D75', '/memory mm show e2e-id', 'command'],
  ['D76', '/memory mm refresh', 'command'],
  ['D77', '/memory mm history e2e-id', 'command'],
  ['D78', '/memory mm seed', 'command'],
  ['D79', '/memory mm delete e2e-id', 'command'],
  ['D80', '/memory mm reload', 'command'],
  // /export writes one file the user asked for, resolved against the run's
  // project directory by resolveExportCommand.
  ['D81', '/export copy', 'command'],
  ['D82', '/export clipboard', 'command'],
  ['D83', '/export --copy', 'command'],
  ['D84', '/export', 'command'],
  ['D85', '/export dummy/e2e-export.html', 'command'],
  ['D86', '/rename', 'command'],
  ['D87', '/rename E2E Dummy Session', 'command'],
];

const GROUP_E: readonly Row[] = [
  // Data loss, credential changes, and writes to configuration shared with
  // every other project on this machine. They run at once, as in the CLI.
  ['E01', '/clear', 'command'],
  ['E02', '/compact', 'command'],
  ['E03', '/compact focus e2e', 'command'],
  ['E04', '/handoff', 'command'],
  ['E05', '/handoff focus e2e', 'command'],
  ['E06', '/session delete', 'command'],
  ['E07', '/contribute-pr', 'command'],
  ['E08', '/contribute-pr focus e2e', 'command'],
  ['E09', '/memory clear', 'command'],
  ['E10', '/memory reset', 'command'],
  ['E11', '/memory enqueue', 'command'],
  ['E12', '/memory rebuild', 'command'],
  ['E13', '/login', 'command'],
  ['E14', '/login anthropic', 'command'],
  ['E15', '/logout', 'command'],
  ['E16', '/logout anthropic', 'command'],
  ['E17', '/ssh add e2e-host --host 127.0.0.1', 'command'],
  ['E18', '/ssh add e2e-host --host 127.0.0.1 --scope project', 'command'],
  ['E19', '/ssh add e2e-host --host 127.0.0.1 --scope user', 'command'],
  ['E20', '/ssh add e2e-host --host 127.0.0.1 --user e2e-user --port 2222 --key /tmp/e2e-key', 'command'],
  ['E21', '/ssh remove e2e-host', 'command'],
  ['E22', '/ssh remove e2e-host --scope project', 'command'],
  ['E23', '/ssh remove e2e-host --scope user', 'command'],
  ['E24', '/ssh rm e2e-host', 'command'],
];

const GROUP_F: readonly Row[] = [
  // Bundled skills. /skill:team is declined outright because it drives tmux
  // panes the app cannot show; the rest run.
  ['F01', '/skill:deep-interview', 'command'],
  ['F02', '/skill:ralplan', 'command'],
  ['F03', '/skill:team', 'notice'],
  ['F04', '/skill:ultragoal', 'command'],
];

const GROUP_G: readonly Row[] = [
  // AGENTS.md generation is terminal-only until the app has a headless init
  // path, so both forms stop at the app's unsupported-command notice.
  ['G01', '/init', 'notice'],
  ['G02', '/init e2e-arg', 'notice'],
];

const MATRIX: readonly Row[] = [
  ...GROUP_A,
  ...GROUP_B,
  ...GROUP_C,
  ...GROUP_D,
  ...GROUP_E,
  ...GROUP_F,
  ...GROUP_G,
];

test('every row in the matrix gets its expected disposition', () => {
  const mismatches: string[] = [];
  for (const [id, form, expected] of MATRIX) {
    const actual = classifyCommandInput(form).kind;
    if (actual !== expected) mismatches.push(`${id} "${form}": expected ${expected}, got ${actual}`);
  }
  assert.deepEqual(mismatches, []);
});

test('row ids and typed forms are unique', () => {
  const ids = MATRIX.map(([id]) => id);
  const forms = MATRIX.map(([, form]) => form);
  assert.equal(new Set(ids).size, ids.length, 'duplicate row id');
  assert.equal(new Set(forms).size, forms.length, 'duplicate typed form');
});

test('no row in the matrix is auto-sendable', () => {
  // Every row is a slash form, and the queued producer has no session UI to
  // show a picker, render a notice, or show a command's effect to anyone.
  for (const [id, form] of MATRIX) {
    assert.equal(isAutoSendable(classifyCommandInput(form)), false, `${id} "${form}"`);
  }
});

test('group B covers every TUI-only key, bare and with arguments', () => {
  // The matrix is written out by hand, so it can silently fall behind the
  // registry it was derived from. This is the one place the two are compared.
  const keys = Object.keys(TUI_ONLY_COMMAND_HINTS);
  const covered = new Set(GROUP_B.map(([, form]) => form.split(' ')[0]));
  // /help is a TUI-only key too, but it is exercised by A12-A14 alongside the
  // bare `help` alias, so it is deliberately not duplicated into group B.
  const expected = keys.filter((key) => key !== '/help');
  for (const key of expected) assert.ok(covered.has(key), `${key} is missing from group B`);
  assert.equal(covered.size, expected.length, 'group B has a key the registry dropped');
  assert.equal(GROUP_B.length, expected.length * 2, 'every key needs a bare and an argument row');
});

test('runtime forms, skills and forms the app has never seen all reach the runtime', () => {
  for (const form of ['/clear', '/skill:ralplan', '/skill:ralplan --deliberate', '/skill:e2e-project-local', '/notacommand-e2e']) {
    assert.equal(classifyCommandInput(form).kind, 'command', form);
  }
});

test('the matrix has not silently shrunk', () => {
  assert.equal(GROUP_A.length, 15);
  assert.equal(GROUP_B.length, 28);
  assert.equal(GROUP_C.length, 20);
  assert.equal(GROUP_D.length, 87);
  assert.equal(GROUP_E.length, 24);
  assert.equal(GROUP_F.length, 4);
  assert.equal(GROUP_G.length, 2);
  assert.equal(MATRIX.length, 180);
});
