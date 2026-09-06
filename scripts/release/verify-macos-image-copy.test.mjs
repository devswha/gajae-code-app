import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { verifyCopiedFromImage } from './verify-macos-image-copy.mjs';

function fixture(t, { fail, detachFails = false } = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'gajae-image-copy-test-'));
  // The fixture creates ordinary directories, never a real mount.
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const state = { temporaryRoot, detachAttempts: 0 };
  const appName = 'Gajae Code App.app';
  const run = (program, args) => {
    if (program === 'hdiutil' && args[0] === 'attach') {
      state.mount = args.at(-1);
      const app = join(state.mount, appName);
      mkdirSync(app);
      writeFileSync(join(app, 'sealed-resource'), 'retained image contents');
      if (fail === 'attach') throw new Error('attach failed after mounting');
    } else if (program === 'hdiutil' && args[0] === 'detach') {
      state.detachAttempts++;
      assert.equal(args[1], state.mount);
      assert.equal(readFileSync(join(state.mount, appName, 'sealed-resource'), 'utf8'), 'retained image contents');
      if (detachFails) throw new Error('image busy');
    } else if (program === 'ditto') {
      if (fail === 'copy') throw new Error('copy failed');
      cpSync(args[0], args[1], { recursive: true });
    } else if (program === 'codesign') {
      assert.equal(readFileSync(join(args.at(-1), 'sealed-resource'), 'utf8'), 'retained image contents');
      if (fail === 'signature') throw new Error('signature failed');
    } else assert.fail(`Unexpected command: ${program}`);
  };
  state.execute = () => verifyCopiedFromImage('/fixture.dmg', appName, { run, temporaryRoot });
  return state;
}

test('successful writable-copy verification detaches before removing temporary files', t => {
  const state = fixture(t);
  state.execute();
  assert.equal(state.detachAttempts, 1);
  assert.deepEqual(readdirSync(state.temporaryRoot), []);
});

test('partial attach, copy and signature failures still detach and preserve the original error', async t => {
  for (const fail of ['attach', 'copy', 'signature']) {
    await t.test(fail, t => {
      const state = fixture(t, { fail });
      assert.throws(state.execute, new RegExp(`${fail} failed`));
      assert.equal(state.detachAttempts, 1);
      assert.deepEqual(readdirSync(state.temporaryRoot), []);
    });
  }
});

test('unconfirmed detachment retains image contents and reports the mount for manual recovery', async t => {
  for (const fail of [undefined, 'attach', 'copy', 'signature']) {
    await t.test(fail ?? 'verification passed', t => {
      const state = fixture(t, { fail, detachFails: true });
      assert.throws(state.execute, error => error.message.includes('Could not confirm image detachment')
        && error.message.includes(state.mount) && error.cause.message === 'image busy');
      assert.equal(state.detachAttempts, 1);
      assert.equal(readFileSync(join(state.mount, 'Gajae Code App.app/sealed-resource'), 'utf8'), 'retained image contents');
      assert.equal(readdirSync(state.temporaryRoot).length, 1);
      assert.equal(existsSync(state.mount), true);
    });
  }
});
