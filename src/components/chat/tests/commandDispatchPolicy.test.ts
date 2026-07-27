import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_UI_COMMANDS,
  APP_UNSUPPORTED_COMMAND_HINTS,
  RUNTIME_COMMAND_ALIASES,
  TUI_ONLY_COMMAND_HINTS,
} from '../appUiCommands';
import {
  classifyCommandInput,
  isAutoSendable,
  parseCommandName,
} from '../commandDispatchPolicy';

/*
 * The shared pre-dispatch rule.
 *
 * Both `chat.send` producers consult this. The composer used to be the only
 * one that classified slash input, and it does so after the in-flight-turn
 * stash — so a slash command typed during a run was persisted as a plain
 * draft and later dispatched as raw text by the queued producer.
 */

test('plain prose is allowed', () => {
  for (const prose of ['hello', 'what does / mean?', 'a/b', '  spaced  ', '']) {
    assert.deepEqual(classifyCommandInput(prose), { kind: 'allow' }, `prose: ${prose}`);
  }
});

test('every app UI command classifies as an app action in its bare form', () => {
  for (const command of APP_UI_COMMANDS) {
    const disposition = classifyCommandInput(command.name);
    assert.equal(disposition.kind, 'app-action', `${command.name} bare`);
    assert.equal(
      disposition.kind === 'app-action' ? disposition.command.actionId : '',
      command.actionId,
    );
  }
});

test('interceptWithArgs:false claims only the bare form', () => {
  // /model opens the picker; "/model gpt-x" belongs to the text runtime.
  assert.equal(classifyCommandInput('/model').kind, 'app-action');
  assert.equal(classifyCommandInput('/model gpt-x').kind, 'command');

  // Commands without the flag keep claiming the argument form.
  assert.equal(classifyCommandInput('/resume').kind, 'app-action');
  assert.equal(classifyCommandInput('/resume yesterday').kind, 'app-action');
});

test('every TUI-only key classifies as a notice, bare and with arguments', () => {
  for (const name of Object.keys(TUI_ONLY_COMMAND_HINTS)) {
    for (const input of [name, `${name} some-arg`]) {
      const disposition = classifyCommandInput(input);
      assert.equal(disposition.kind, 'notice', `${input} should be a notice`);
      assert.match(
        disposition.kind === 'notice' ? disposition.text : '',
        /not available in the app/,
      );
    }
  }
});

test('every runtime alias classifies identically to its canonical name', () => {
  for (const [alias, canonical] of Object.entries(RUNTIME_COMMAND_ALIASES)) {
    const aliasKind = classifyCommandInput(alias).kind;
    const canonicalKind = classifyCommandInput(canonical).kind;
    assert.equal(aliasKind, canonicalKind, `${alias} must match ${canonical}`);
    assert.notEqual(aliasKind, 'allow', `${alias} must never pass as prose`);
  }
});

test('app-declined runtime commands classify as a notice, not prose', () => {
  for (const name of Object.keys(APP_UNSUPPORTED_COMMAND_HINTS)) {
    for (const input of [name, `${name} /some/path`]) {
      const disposition = classifyCommandInput(input);
      assert.equal(disposition.kind, 'notice', `${input} must be a notice`);
      assert.match(
        disposition.kind === 'notice' ? disposition.text : '',
        /not available in the app/,
      );
    }
  }
});

test('the bare help alias is treated as /help', () => {
  for (const alias of ['help', 'HELP', ' Help ']) {
    assert.deepEqual(parseCommandName(alias), { commandName: '/help', args: '' }, alias);
  }
  // "help me debug this" is prose, not the alias.
  assert.equal(parseCommandName('help me debug this'), null);
  assert.deepEqual(classifyCommandInput('help me debug this'), { kind: 'allow' });
});

test('trailing whitespace does not defeat interception', () => {
  assert.equal(classifyCommandInput('/clear   ').kind, 'gate');
  assert.equal(classifyCommandInput('/retry\t').kind, 'notice');
  assert.equal(classifyCommandInput('/dump  ').kind, 'command');
});

test('unrecognized slash forms fail closed rather than passing as prose', () => {
  for (const unknown of ['/e2e-unknown-form', '/notacommand hello', '/']) {
    const disposition = classifyCommandInput(unknown);
    // Never `allow`, and never dispatched without asking either.
    assert.equal(disposition.kind, 'gate', `${unknown} must be gated`);
    assert.equal(isAutoSendable(disposition), false);
  }
});

test('destructive runtime commands are never auto-sendable', () => {
  const destructive = [
    '/clear',
    '/compact',
    '/handoff',
    '/session delete',
    '/contribute-pr',
    '/memory clear',
    '/memory reset',
    '/logout',
    '/ssh add e2e-host --host 127.0.0.1',
    '/ssh remove e2e-host',
    '/ssh rm e2e-host',
    '/skill:team',
    '/skill:ultragoal',
  ];
  for (const form of destructive) {
    assert.equal(isAutoSendable(classifyCommandInput(form)), false, `${form} must be held`);
  }
});

test('only the allow disposition is auto-sendable', () => {
  assert.equal(isAutoSendable({ kind: 'allow' }), true);
  assert.equal(isAutoSendable(classifyCommandInput('/new')), false);
  assert.equal(isAutoSendable(classifyCommandInput('/retry')), false);
  assert.equal(isAutoSendable(classifyCommandInput('/dump')), false);
  assert.equal(isAutoSendable(classifyCommandInput('just a message')), true);
});
