import assert from 'node:assert/strict';
import test from 'node:test';

import { escapesOwnedCheckout, mutatesSharedGitState, sharedCheckoutGate } from './gjc-shared-checkout-guard.js';

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

test('a run that owns a checkout is exempt for git state inside it', () => {
  const root = '/repo/.gjc-worktrees/job-1';
  for (const command of [
    'git commit -am wip',
    'git push origin HEAD',
    // A redirect that stays under the owned checkout is still the run's own.
    'git -C sub commit -m x',
    'git -C /repo/.gjc-worktrees/job-1/nested reset --hard',
    'cd sub && git checkout main',
    'git -C ../job-1 push',
    // Reads never ask, wherever they point.
    'git -C /repo status',
  ]) {
    assert.equal(sharedCheckoutGate('bash', { command }, root), null, command);
  }
});

test('a run that owns a checkout is gated when git state leaves it', () => {
  const root = '/repo/.gjc-worktrees/job-1';
  for (const command of [
    'git -C /repo commit -am wip',
    'git -C ../.. commit -am wip',
    'git -C../.. push',
    'cd /repo && git push origin HEAD',
    'cd .. && git reset --hard',
    // `cd` with no target goes HOME, which is never inside the worktree.
    'cd && git commit -m x',
    'git --git-dir /repo/.git commit -m x',
    'git --git-dir=/repo/.git commit -m x',
    'git --work-tree /repo commit -m x',
    'GIT_DIR=/repo/.git git commit',
    'GIT_WORK_TREE=/repo env git push',
    'npm test && git -C ../.. push',
  ]) {
    assert.equal(sharedCheckoutGate('bash', { command }, root), 'escape', command);
  }
});

test('a project location is gated for shell tools only', () => {
  assert.equal(sharedCheckoutGate('bash', { command: 'git commit -am x' }), 'shared');
  assert.equal(sharedCheckoutGate('powershell', { command: 'git push' }), 'shared');
  assert.equal(sharedCheckoutGate('BASH', { command: 'git push' }), 'shared');
  // An editing tool cannot move HEAD, and gating it here would double-gate the
  // policy that already owns edits.
  assert.equal(sharedCheckoutGate('edit', { command: 'git push' }), null);
  assert.equal(sharedCheckoutGate('read', { path: '/repo/x' }), null);
});

test('a tool call whose input is not shaped as expected is not gated', () => {
  assert.equal(sharedCheckoutGate('bash', undefined), null);
  assert.equal(sharedCheckoutGate('bash', { command: 123 }), null);
  assert.equal(sharedCheckoutGate('bash', 'git push'), null);
  assert.equal(sharedCheckoutGate(undefined, { command: 'git push' }), null);
  assert.equal(sharedCheckoutGate('bash', { command: 'git push' }, '/owned'), null);
  assert.equal(escapesOwnedCheckout(undefined, '/owned'), false);
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
  assert.equal(escapesOwnedCheckout('G=git; $G commit -m x', '/owned'), false);
  // A script whose contents the app never sees.
  assert.equal(mutatesSharedGitState('bash ./release.sh'), false);
  assert.equal(escapesOwnedCheckout('bash ./release.sh', '/owned'), false);
  // Another program reaching the same plumbing.
  assert.equal(mutatesSharedGitState('gh pr merge 1 --squash'), false);
  // A redirection the owned-checkout walk cannot see: the `cd` lives inside a
  // substitution, so the following `git` still looks like it runs at the root.
  assert.equal(escapesOwnedCheckout('x=$(cd /repo && git commit -m x)', '/owned'), false);
});
