import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EGO_ACTIVITY_SCRIPT,
  EGO_ACTIVITY_TOKEN_PREFIX,
  egoActivityToken,
  matchesEgoActivityToken,
  parseEgoActivityOutput,
  readEgoActivity,
  selectEgoActivitySpaces,
  type EgoActivityExecFile,
} from './gjc-ego-activity.js';

function output(spaces: unknown): string {
  return `${JSON.stringify({ v: 1, spaces })}\n`;
}

test('the session token is derived, stable and shaped for the routing block', () => {
  const token = egoActivityToken('session-a');
  assert.match(token, /^gjc-[0-9a-f]{8}$/u);
  assert.equal(token.startsWith(EGO_ACTIVITY_TOKEN_PREFIX), true);
  // Derived, so a resumed session recomputes the same label without storage.
  assert.equal(egoActivityToken('session-a'), token);
  assert.notEqual(egoActivityToken('session-b'), token);
  assert.equal(matchesEgoActivityToken(`${token} fix the login page`, token), true);
  assert.equal(matchesEgoActivityToken(`${egoActivityToken('session-b')} other work`, token), false);
  assert.equal(matchesEgoActivityToken(undefined, token), false);
});

test('the observation script is a read-only constant: no interpolation, no mutating API', () => {
  // A template that interpolated anything would put app, session or model text
  // inside a program running against the user's logged-in browser.
  assert.equal(EGO_ACTIVITY_SCRIPT.includes('${'), false);
  assert.match(EGO_ACTIVITY_SCRIPT, /listTaskSpaces\(\)/u);
  assert.match(EGO_ACTIVITY_SCRIPT, /task\.tabs\(\)/u);
  // Only agent-created, agent-owned, app-labelled spaces leave ego at all.
  assert.match(EGO_ACTIVITY_SCRIPT, /createdBy !== "agent"/u);
  assert.match(EGO_ACTIVITY_SCRIPT, /ownership !== "agent"/u);
  assert.match(EGO_ACTIVITY_SCRIPT, /startsWith\("gjc-"\)/u);
  assert.match(EGO_ACTIVITY_SCRIPT, /openedBy !== "agent"/u);
  for (const forbidden of [
    'goto', 'click', 'fill', 'press', 'evaluate', 'cdp', 'screenshot', 'snapshot',
    'adopt', 'release', 'claimTaskSpace', 'takeOverTaskSpace', 'handOff', 'finish',
    'close', 'events(', 'newPage', 'setInputFiles', 'profiles(',
  ]) {
    assert.equal(EGO_ACTIVITY_SCRIPT.includes(forbidden), false, forbidden);
  }
});

test('output is bounded, redacted and attributed; anything unexpected yields nothing', () => {
  const token = egoActivityToken('session-a');
  const snapshot = parseEgoActivityOutput(output([
    {
      id: 7,
      name: `${token} · check the dashboard`,
      pages: [
        { label: 'p1', url: 'https://app.example.com/reports?token=secret#anchor', title: 'Reports  ', active: true },
        { label: 'p2', url: 'about:blank', title: '', active: false },
        { label: '', url: 'https://example.com', title: 'unlabelled', active: false },
      ],
    },
    { id: 8, name: 'personal shopping', pages: [{ label: 'p1', url: 'https://bank.example.com/x', title: 'Bank', active: true }] },
  ]));

  assert.equal(snapshot.spaces.length, 1, 'a space without the app token is never attributed or rendered');
  const [space] = snapshot.spaces;
  assert.equal(space.id, 7);
  assert.equal(space.token, token);
  assert.equal(space.name, 'check the dashboard', 'the token and its separator are plumbing, not a label');
  assert.deepEqual(space.pages.map((page) => page.url), ['https://app.example.com/reports', 'about:blank']);
  assert.equal(space.pages[0].title, 'Reports');
  assert.equal(space.pages[0].active, true);
  assert.equal(space.pages.length, 2, 'a page without a durable label is dropped');

  assert.deepEqual(selectEgoActivitySpaces(snapshot, token).map((entry) => entry.id), [7]);
  assert.deepEqual(selectEgoActivitySpaces(snapshot, egoActivityToken('session-b')), []);

  for (const broken of ['', 'not json', JSON.stringify({ v: 2, spaces: [] }), JSON.stringify({ v: 1 }), 'null']) {
    assert.deepEqual(parseEgoActivityOutput(broken).spaces, [], broken);
  }
});

test('long titles, long names and oversized lists are capped', () => {
  const token = egoActivityToken('session-a');
  const snapshot = parseEgoActivityOutput(output([
    {
      id: 1,
      name: `${token} ${'goal '.repeat(60)}`,
      pages: Array.from({ length: 20 }, (_, index) => ({
        label: `p${index + 1}`, url: 'https://example.com/a', title: 'x'.repeat(400), active: false,
      })),
    },
    ...Array.from({ length: 9 }, (_, index) => ({ id: index + 2, name: `${token} more`, pages: [] })),
  ]));
  assert.equal(snapshot.spaces.length, 4);
  assert.equal(snapshot.spaces[0].pages.length, 8);
  assert.equal(snapshot.spaces[0].pages[0].title.length, 120);
  assert.equal(snapshot.spaces[0].name.length <= 80, true);
});

test('the report is found wherever the CLI wrote it: stderr, and around its own notices', async () => {
  const token = egoActivityToken('session-a');
  const report = JSON.stringify({ v: 1, spaces: [{ id: 3, name: `${token} work`, pages: [] }] });
  // ego-browser 0.5 writes a piped program's console.log to stderr, and may add
  // its own lines before or after it.
  const parsed = parseEgoActivityOutput(`ego lite notice\n${report}\n[ego-browser:notice] an update is available\n`);
  assert.deepEqual(parsed.spaces.map((space) => space.id), [3]);
  assert.deepEqual(parseEgoActivityOutput(`${report}\n{"v":2,"spaces":[]}`).spaces.map((space) => space.id), [3]);
});

test('the CLI is executed without a shell, with a minimal environment and the fixed script', async () => {
  const calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const execFile: EgoActivityExecFile = async (file, args, options) => {
    calls.push({ file, args, options: options as unknown as Record<string, unknown> });
    // Both streams are read; this CLI answers on stderr when it is piped.
    return { stdout: '', stderr: output([{ id: 3, name: `${egoActivityToken('s')} work`, pages: [] }]) };
  };

  const snapshot = await readEgoActivity({
    cliPath: '/Users/me/.local/bin/ego-browser',
    execFile,
    env: { PATH: '/usr/bin', HOME: '/Users/me', SECRET: 'do-not-forward' } as NodeJS.ProcessEnv,
  });

  assert.equal(snapshot.spaces.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, '/Users/me/.local/bin/ego-browser', 'the probe-resolved absolute path is executed as-is');
  assert.deepEqual(calls[0].args, ['nodejs', '-e', EGO_ACTIVITY_SCRIPT]);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.env, { PATH: '/usr/bin', HOME: '/Users/me' }, 'no user environment reaches ego');
  assert.equal(typeof calls[0].options.timeout, 'number');
});

test('a broken, closed or upgrading ego lite hides the surface instead of failing a run', async () => {
  const execFile: EgoActivityExecFile = async () => { throw new Error('spawn ENOENT'); };
  const snapshot = await readEgoActivity({ cliPath: '/tmp/ego-browser', execFile });
  assert.deepEqual(snapshot.spaces, []);
  assert.equal(snapshot.unavailable, true);

  const garbage: EgoActivityExecFile = async () => ({ stdout: 'ego lite is updating\n', stderr: '' });
  const ignored = await readEgoActivity({ cliPath: '/tmp/ego-browser', execFile: garbage });
  assert.deepEqual(ignored.spaces, []);
  assert.equal(ignored.unavailable, undefined);
});
