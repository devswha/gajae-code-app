import assert from 'node:assert/strict';
import test from 'node:test';

import { mutatesSharedGitState, requiresSharedCheckoutApproval } from './gjc-shared-checkout-guard.js';

/*
 * A session that chose the project location shares its working tree with the
 * user and every other session of that project, so moving `HEAD` or the index
 * there is not a private act. On 2026-09-17 an unattended run committed,
 * pushed and switched branches in a shared checkout while a second session was
 * mid-read, under a project policy of `bypass`, and nothing asked.
 *
 * These pin the matcher, which decides whether a card appears. It is a prompt
 * and not a sandbox: the tests below record what it does catch, and the last
 * group records, on purpose, what it does not.
 */

test('the state-changing git subcommands are matched', () => {
  for (const command of [
    'git commit -m "x"',
    'git push origin main',
    'git checkout main',
    'git switch -c feature',
    'git branch -D old',
    'git merge main',
    'git rebase -i HEAD~3',
    'git reset --hard HEAD~1',
    'git revert abc123',
    'git cherry-pick abc123',
    'git stash',
    'git clean -fd',
    'git restore .',
    'git pull --rebase',
    'git worktree remove /tmp/x',
  ]) {
    assert.equal(mutatesSharedGitState(command), true, command);
  }
});

test('reads and non-git commands are left alone', () => {
  for (const command of [
    'git status',
    'git log --oneline -5',
    'git diff HEAD',
    'git show abc123',
    'git rev-parse HEAD',
    'git --version',
    'npm test',
    'ls -la',
    'rg "pattern" src/',
    'echo git commit',
  ]) {
    assert.equal(mutatesSharedGitState(command), false, command);
  }
});

test('a mutation hiding behind a separator is still found', () => {
  // The dangerous half is usually not the first one.
  for (const command of [
    'npm test && git commit -am wip',
    'git status; git push',
    'make build || git reset --hard',
    'git add -A | git commit -F -',
    'cd /repo\ngit checkout main',
  ]) {
    assert.equal(mutatesSharedGitState(command), true, command);
  }
});

test('flags that take a value do not hide the subcommand behind them', () => {
  // `-C <path>` is the classic redirect: the subcommand is two tokens later.
  assert.equal(mutatesSharedGitState('git -C /elsewhere commit -m x'), true);
  assert.equal(mutatesSharedGitState('git --git-dir /a/.git --work-tree /a commit'), true);
  assert.equal(mutatesSharedGitState('git -c user.name=x commit'), true);
  assert.equal(mutatesSharedGitState('git -C /elsewhere status'), false);
});

test('env prefixes and wrappers do not hide that git is what runs', () => {
  assert.equal(mutatesSharedGitState('GIT_DIR=/a/.git git commit'), true);
  assert.equal(mutatesSharedGitState('sudo git push'), true);
  assert.equal(mutatesSharedGitState('env GIT_AUTHOR_NAME=x git commit'), true);
  assert.equal(mutatesSharedGitState('/usr/bin/git commit'), true);
  assert.equal(mutatesSharedGitState('command git reset --hard'), true);
});

test('a program that merely starts with git is not git', () => {
  assert.equal(mutatesSharedGitState('gitk --all'), false);
  assert.equal(mutatesSharedGitState('mygit commit'), false);
  assert.equal(mutatesSharedGitState('github-cli push'), false);
});

test('malformed input is not a mutation', () => {
  for (const value of [undefined, null, 42, '', '   ', {}, []]) {
    assert.equal(mutatesSharedGitState(value), false, JSON.stringify(value));
  }
});

/*
 * The decision the provider actually makes.
 */

test('an isolated session is never gated, whatever it runs', () => {
  assert.equal(requiresSharedCheckoutApproval('bash', { command: 'git push --force' }, true), false);
  assert.equal(requiresSharedCheckoutApproval('bash', { command: 'git reset --hard' }, true), false);
});

test('a shared checkout is gated for shell tools only', () => {
  assert.equal(requiresSharedCheckoutApproval('bash', { command: 'git commit -am x' }, false), true);
  assert.equal(requiresSharedCheckoutApproval('powershell', { command: 'git push' }, false), true);
  assert.equal(requiresSharedCheckoutApproval('BASH', { command: 'git push' }, false), true);
  // An editing tool cannot move HEAD, and gating it here would double-gate the
  // policy that already owns edits.
  assert.equal(requiresSharedCheckoutApproval('edit', { command: 'git push' }, false), false);
  assert.equal(requiresSharedCheckoutApproval('read', { path: '/repo/x' }, false), false);
});

test('a tool call whose input is not shaped as expected is not gated', () => {
  assert.equal(requiresSharedCheckoutApproval('bash', undefined, false), false);
  assert.equal(requiresSharedCheckoutApproval('bash', { command: 123 }, false), false);
  assert.equal(requiresSharedCheckoutApproval('bash', 'git push', false), false);
  assert.equal(requiresSharedCheckoutApproval(undefined, { command: 'git push' }, false), false);
});

/*
 * What this deliberately does not catch.
 *
 * Recorded rather than hidden: the guard is an approval prompt, and command
 * text can be written to defeat text matching. Containment is the runtime's
 * job, not this function's. If any of these ever needs to be caught, it is a
 * decision to make on purpose, not a regression to discover.
 */

test('text written to defeat matching is not caught, and that is the documented limit', () => {
  // A computed command name never appears as `git` in the text.
  assert.equal(mutatesSharedGitState('G=git; $G commit -m x'), false);
  // A script whose contents the app never sees.
  assert.equal(mutatesSharedGitState('bash ./release.sh'), false);
  // Another program reaching the same plumbing.
  assert.equal(mutatesSharedGitState('gh pr merge 1 --squash'), false);
});
