import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createSystemOpener, createSystemRouter } from './system.js';

async function serve(opener) {
  const app = express();
  app.use(express.json());
  app.use('/api/system', createSystemRouter({ opener }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    postOpenFile: (body) => fetch(`http://127.0.0.1:${port}/api/system/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    postOpenUrl: (body) => fetch(`http://127.0.0.1:${port}/api/system/open-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    postDebugBundle: (body) => fetch(`http://127.0.0.1:${port}/api/system/debug-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('open-file rejects relative and non-string paths', async () => {
  const server = await serve(async () => {});
  try {
    for (const body of [{ path: 'relative/file.txt' }, { path: 42 }, { path: `${tmpdir()}\0injected` }, {}]) {
      assert.equal((await server.postOpenFile(body)).status, 400);
    }
  } finally {
    await server.close();
  }
});

test('open-file reports a missing file before invoking the opener', async () => {
  let opened = null;
  const server = await serve(async (target) => { opened = target; });
  try {
    const response = await server.postOpenFile({ path: path.join(tmpdir(), `gajae-missing-${Date.now()}`) });
    assert.equal(response.status, 404);
    assert.equal(opened, null);
  } finally {
    await server.close();
  }
});

test('open-file hands an existing absolute path to the opener', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gajae-open-file-'));
  const target = path.join(dir, 'note.txt');
  writeFileSync(target, 'hello');
  let opened = null;
  const server = await serve(async (file) => { opened = file; });
  try {
    const response = await server.postOpenFile({ path: target });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(opened, target);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open-file surfaces opener failures as a 500', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gajae-open-file-'));
  const target = path.join(dir, 'note.txt');
  writeFileSync(target, 'hello');
  const server = await serve(async () => { throw new Error('no opener available'); });
  try {
    assert.equal((await server.postOpenFile({ path: target })).status, 500);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open-url hands an https link to the OS opener and refuses everything else', async () => {
  const opened = [];
  const server = await serve(async (target) => { opened.push(target); });
  try {
    assert.equal((await server.postOpenUrl({ url: 'https://auth.example.com/oauth?code=1' })).status, 200);
    assert.deepEqual(opened, ['https://auth.example.com/oauth?code=1']);
    for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'x-apple.systempreferences:', 42, '']) {
      assert.equal((await server.postOpenUrl({ url })).status, 400, `${String(url)} must be refused`);
    }
    assert.equal(opened.length, 1);
  } finally {
    await server.close();
  }
});

function captureWindowsOpener(error = null) {
  const calls = [];
  const opener = createSystemOpener({
    platform: 'win32', env: { systemroot: 'D:\\Windows' },
    execute: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(error);
    },
  });
  return { opener, calls };
}

function assertLiteralWindowsTarget(call, target) {
  assert.equal(call.command, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(call.options, { windowsHide: true, shell: false });
  assert.deepEqual(call.args.slice(0, -1), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.match(call.args.at(-1), /^[A-Za-z0-9+/=]+$/);
  const script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le');
  const match = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/);
  assert.ok(match, 'the target must be carried as data, never shell syntax');
  assert.equal(Buffer.from(match[1], 'base64').toString('utf8'), target);
  assert.equal(script, [
    "$ErrorActionPreference = 'Stop'",
    '$info = New-Object System.Diagnostics.ProcessStartInfo',
    `$info.FileName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${match[1]}'))`,
    '$info.UseShellExecute = $true',
    '[void][System.Diagnostics.Process]::Start($info)',
  ].join('; '));
}

test('Windows opener preserves paths, UNC shares and URL metacharacters without cmd expansion', async () => {
  const { opener, calls } = captureWindowsOpener();
  const targets = [
    "C:\\Users\\O'Brien & Co\\%USERPROFILE% !x! ^ (한글)\\note.txt",
    'C:\\Users\\smart‘’quotes\\$(calc);note.txt',
    '\\\\server\\shared files\\100% ready & done.txt',
    'https://example.com/oauth?code=a&state=%PATH%!x!^|echo&return=";$(calc)#fragment',
  ];
  for (const target of targets) await opener(target);
  assert.equal(calls.length, targets.length);
  calls.forEach((call, index) => assertLiteralWindowsTarget(call, targets[index]));
});

test('open-file and open-url keep literal targets through the Windows process-launch boundary', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gajae-system-windows-'));
  const target = path.join(dir, "한글 O'Brien & %PATH% !test! ‘quoted’.txt");
  writeFileSync(target, 'hello');
  const { opener, calls } = captureWindowsOpener();
  const server = await serve(opener);
  try {
    assert.equal((await server.postOpenFile({ path: target })).status, 200);
    const url = 'https://example.com/oauth?code=a&state=%PATH%!test!^|echo&return=%22%26calc#fragment';
    assert.equal((await server.postOpenUrl({ url })).status, 200);
    assert.equal(calls.length, 2);
    assertLiteralWindowsTarget(calls[0], target);
    assertLiteralWindowsTarget(calls[1], new URL(url).href);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows process-launch failures reach the HTTP error response', async () => {
  const { opener } = captureWindowsOpener(new Error('ShellExecute failed'));
  const server = await serve(opener);
  try {
    const response = await server.postOpenUrl({ url: 'https://example.com/' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Failed to open the link' });
  } finally {
    await server.close();
  }
});

test('macOS and Linux openers still pass a single literal target without a shell', async () => {
  for (const [platform, expected] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
    const calls = [];
    const opener = createSystemOpener({ platform, execute: (...args) => { calls.push(args.slice(0, -1)); args.at(-1)(null); } });
    const target = '/tmp/note with spaces & $(echo injected).txt';
    await opener(target);
    assert.deepEqual(calls, [[expected, [target], { windowsHide: true, shell: false }]]);
  }
});

test('debug-bundle carries the session row, the transcript tail and the log tails as text', async () => {
  const server = await serve(async () => {});
  try {
    const noSession = await server.postDebugBundle({ sessionId: 'no-such-session' });
    assert.equal(noSession.status, 200);
    const bundle = (await noSession.json()).bundle;
    assert.match(bundle, /# Gajae Code App debug bundle/);
    assert.match(bundle, /no session "no-such-session"/);
    assert.match(bundle, /## worker log tail/);
    assert.match(bundle, /## browser sidecar log tail/);
    assert.doesNotMatch(bundle, /undefined/);
  } finally {
    await server.close();
  }
});
