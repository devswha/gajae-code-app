import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCommandInput } from '../commandDispatchPolicy';
import { UNCLASSIFIED_GATE_REASON, gateForCommand } from '../commandGatePolicy';

/*
 * The allowlist decides what runs without asking.
 *
 * These tests exist because the failure is asymmetric: a form wrongly on the
 * safe side runs unconfirmed and can lose a session, while a form wrongly off
 * it only asks once. Every assertion below is written so that drifting toward
 * "runs without asking" fails.
 */

const gated = (text: string) => {
  const disposition = classifyCommandInput(text);
  assert.equal(disposition.kind, 'gate', `${text} must be gated`);
  return disposition.kind === 'gate' ? disposition.gate : null;
};

const ungated = (text: string) => {
  const disposition = classifyCommandInput(text);
  assert.equal(disposition.kind, 'command', `${text} must run without a gate`);
};

test('data-loss forms are gated and say what is lost', () => {
  const cases: ReadonlyArray<[string, RegExp]> = [
    ['/clear', /context/i],
    ['/compact', /summary|recoverable/i],
    ['/compact focus on the parser', /summary|recoverable/i],
    ['/handoff', /handoff|new session/i],
    ['/session delete', /cannot be undone/i],
    ['/memory clear', /memory/i],
    ['/memory reset', /memory/i],
    ['/memory enqueue', /memory/i],
    ['/memory rebuild', /memory/i],
  ];
  for (const [form, reason] of cases) {
    const gate = gated(form);
    assert.equal(gate?.classified, true, `${form} should be a classified gate`);
    assert.match(gate?.summary ?? '', reason, form);
  }
});

test('auth, external and shared-config forms are gated', () => {
  for (const form of [
    '/login',
    '/login anthropic',
    '/logout',
    '/logout anthropic',
    '/notify test',
    '/notify test hello there',
    '/notify recovery',
    '/ssh add e2e-host --host 127.0.0.1',
    '/ssh remove e2e-host',
    '/ssh rm e2e-host',
    '/provider add glm',
    '/contribute-pr',
    '/contribute-pr focus on tests',
  ]) {
    assert.equal(gated(form)?.classified, true, `${form} should be a classified gate`);
  }
});

test('an alias gates exactly like the command it stands for', () => {
  // Slipping through under a second name is how /contribution-prep reached the
  // model in the first place.
  assert.equal(gated('/contribution-prep')?.gateId, '/contribute-pr');
  assert.equal(gated('/contribution-prep focus e2e')?.gateId, '/contribute-pr');
});

test('every skill invocation is gated', () => {
  for (const skill of ['/skill:deep-interview', '/skill:ralplan', '/skill:ultragoal']) {
    const gate = gated(skill);
    assert.equal(gate?.classified, false, `${skill} falls through to the default gate`);
    assert.equal(gate?.summary, UNCLASSIFIED_GATE_REASON);
  }
});

test('unclassified forms fail closed with the default reason', () => {
  for (const form of ['/some-future-command', '/session archive', '/ssh teleport']) {
    const gate = gated(form);
    assert.equal(gate?.classified, false, form);
    assert.equal(gate?.summary, UNCLASSIFIED_GATE_REASON);
  }
});

test('reads run without asking, in every form', () => {
  for (const form of [
    '/dump',
    '/jobs',
    '/transcript',
    '/context',
    '/usage',
    '/tools',
    '/changelog',
    '/changelog full',
    '/changelog --full',
  ]) {
    ungated(form);
  }
});

test('the read-only default of a mixed command runs without asking', () => {
  // Bare forms route upstream to info/status/view/help/usage.
  for (const form of [
    '/session',
    '/session info',
    '/notify',
    '/notify status',
    '/notify health',
    '/memory',
    '/memory view',
    '/memory mm list',
    '/ssh',
    '/ssh help',
    '/ssh list',
    '/provider',
    '/provider help',
  ]) {
    ungated(form);
  }
});

test('reversible session preferences are not gated', () => {
  // Visible immediately and undone by retyping; a gate here is pure friction.
  for (const form of [
    '/model executor gpt-test',
    '/effort medium',
    '/fast on',
    '/rename New title',
    '/export',
  ]) {
    ungated(form);
  }
});

test('a mixed command gates as soon as the verb leaves the safe set', () => {
  // The pairs that matter: same command, one safe verb and one dangerous one.
  ungated('/session info');
  gated('/session delete');
  ungated('/notify status');
  gated('/notify test');
  ungated('/ssh list');
  gated('/ssh rm e2e-host');
  ungated('/memory view');
  gated('/memory clear');
  ungated('/provider help');
  gated('/provider add glm');
});

test('gateForCommand is case-insensitive on the verb', () => {
  assert.notEqual(gateForCommand('/session', 'DELETE'), null);
  assert.notEqual(gateForCommand('/memory', 'Clear'), null);
});

test('prose and locally answered forms never reach the gate', () => {
  assert.equal(classifyCommandInput('just a message').kind, 'allow');
  assert.equal(classifyCommandInput('/retry').kind, 'notice');
  assert.equal(classifyCommandInput('/new').kind, 'app-action');
});
