import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EGO_ACTIVITY_SCRIPT,
  EGO_ACTIVITY_TOKEN_PREFIX,
  buildEgoFrameScript,
  egoActivityToken,
  matchesEgoActivityToken,
  parseEgoActivityOutput,
  parseEgoFrameOutput,
  readEgoActivity,
  readEgoFrame,
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

test('the frame program interpolates only a validated space id and ego page label', () => {
  const script = buildEgoFrameScript(15, 'p2');
  assert.match(script, /await taskSpace\(15\);/u);
  assert.match(script, /task\.page\("p2"\)/u);
  // Exactly one CDP method, read-only, and the frame is scaled down inside ego
  // rather than shipped at full size.
  assert.equal((script.match(/page\.cdp\(/gu) ?? []).length, 1);
  assert.match(script, /"Page\.captureScreenshot"/u);
  assert.match(script, /format: "jpeg"/u);
  assert.match(script, /Math\.min\(1, 640 \/ width\)/u);
  for (const forbidden of ['goto', 'click', 'evaluate', 'finish', 'adopt', 'handOff', 'events(']) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }

  // A value that is not a space id or an ego page label never reaches the
  // program; it is refused rather than escaped into it.
  for (const badSpace of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => buildEgoFrameScript(badSpace, 'p1'), /positive integer space id/u, String(badSpace));
  }
  for (const badLabel of ['', 'p', 'P1', 'p1"); await task.finish({ keep: [] }); //', 'main', 'p12345', '1']) {
    assert.throws(() => buildEgoFrameScript(3, badLabel), /ego page label/u, JSON.stringify(badLabel));
  }
});

test('only JPEG bytes are relayed as a frame, and oversized or foreign payloads are dropped', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
  const frame = parseEgoFrameOutput(`${JSON.stringify({ v: 1, w: 640, h: 350, jpeg: jpeg.toString('base64') })}\n`);
  assert.equal(frame?.width, 640);
  assert.equal(frame?.height, 350);
  assert.deepEqual(frame?.jpeg, jpeg);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  for (const broken of [
    JSON.stringify({ v: 1, w: 640, h: 350, jpeg: png }),
    JSON.stringify({ v: 1, w: 640, h: 350, jpeg: '' }),
    JSON.stringify({ v: 1, jpeg: jpeg.toString('base64') }),
    JSON.stringify({ v: 2, w: 1, h: 1, jpeg: jpeg.toString('base64') }),
    'not json',
  ]) {
    assert.equal(parseEgoFrameOutput(broken), undefined, broken.slice(0, 40));
  }

  // A capture that fails, times out or returns nothing is simply no frame.
  const failing = await readEgoFrame({ cliPath: '/tmp/ego-browser', spaceId: 3, label: 'p1', execFile: async () => { throw new Error('timeout'); } });
  assert.equal(failing, undefined);
  const refused = await readEgoFrame({ cliPath: '/tmp/ego-browser', spaceId: 3, label: 'nope', execFile: async () => { throw new Error('must not run'); } });
  assert.equal(refused, undefined, 'an invalid label never reaches the CLI');
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
