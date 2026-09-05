import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertDeveloperSignature, assertNotarizedAssessment, verifyMacosRelease } from './local-release-macos.mjs';

const teamId = 'AB12345678';
const signature = `Authority=Developer ID Application: Fixture (${teamId})\nTeamIdentifier=${teamId}\nCodeDirectory v=20500 size=400 flags=0x10000(runtime) hashes=12\n`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gajae-macos-validation-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dmg = join(root, 'original.dmg');
  await writeFile(dmg, 'original immutable image fixture');
  const input = { dmg, root, version: '2.0.0-beta.99', desktopVersion: '0.2.2', teamId };
  const state = { input, calls: [], packageVersion: input.version, desktopVersion: input.desktopVersion };
  state.run = async (program, args) => {
    state.calls.push({ program, args });
    if (state.fail?.(program, args)) throw new Error('Simulated acceptance failure');
    if (program === 'hdiutil' && args[0] === 'attach') {
      const payload = join(root, 'mount/Gajae Code App.app/Contents/Resources/resources/server-payload');
      await mkdir(payload, { recursive: true });
      await writeFile(join(payload, 'package.json'), JSON.stringify({ name: 'gajae-app', version: state.packageVersion }));
    }
    if (program === 'ditto') await cp(args[0], args[1], { recursive: true });
    if (program === 'codesign' && args[0] === '--display') return { stdout: '', stderr: state.signature ?? signature };
    if (program === 'spctl') return { stdout: '', stderr: `${args.at(-1)}: accepted\nsource=Notarized Developer ID\n` };
    if (program === '/usr/libexec/PlistBuddy') return { stdout: args[1].includes('Identifier') ? 'app.gajae.desktop\n' : `${state.desktopVersion}\n`, stderr: '' };
    return { stdout: '', stderr: '' };
  };
  state.execute = () => verifyMacosRelease(input, { run: state.run });
  return state;
}

test('only an explicit Developer ID team and hardened app signature are accepted', () => {
  assertDeveloperSignature(signature, teamId, { hardened: true });
  for (const output of ['Signature=adhoc\nTeamIdentifier=not set', signature.replace(teamId, 'OTHERTEAM1').replace(`TeamIdentifier=${teamId}`, 'TeamIdentifier=OTHERTEAM1'),
    signature.replace('Developer ID Application:', 'Apple Development:')]) {
    assert.throws(() => assertDeveloperSignature(output, teamId));
  }
  assert.throws(() => assertDeveloperSignature(signature.replace('(runtime)', '(none)'), teamId, { hardened: true }), /hardened/);
  assert.throws(() => assertNotarizedAssessment('app: accepted\nsource=Developer ID\n'), /Gatekeeper/);
  assert.throws(() => assertNotarizedAssessment('app: rejected\nsource=Notarized Developer ID\n'), /Gatekeeper/);
});

test('DMG, mounted app and quarantined copy all undergo signature/staple/Gatekeeper validation', async t => {
  const state = await fixture(t);
  await state.execute();
  const targets = [state.input.dmg, join(state.input.root, 'mount/Gajae Code App.app'), join(state.input.root, 'copy/Gajae Code App.app')];
  for (const target of targets) {
    assert.ok(state.calls.some(call => call.program === 'codesign' && call.args[0] === '--verify' && call.args.at(-1) === target));
    assert.ok(state.calls.some(call => call.program === 'xcrun' && call.args[0] === 'stapler' && call.args[1] === 'validate' && call.args.at(-1) === target));
    assert.ok(state.calls.some(call => call.program === 'spctl' && call.args.at(-1) === target));
  }
  const quarantine = state.calls.filter(call => call.program === 'xattr');
  assert.equal(quarantine.length, 1);
  assert.equal(quarantine[0].args.at(-1), targets[2]);
  assert.equal(state.calls.filter(call => call.program === 'lipo').length, 2);
  assert.deepEqual(state.calls.at(-1), { program: 'hdiutil', args: ['detach', join(state.input.root, 'mount')] });
  assert.equal(await readFile(state.input.dmg, 'utf8'), 'original immutable image fixture');
  assert.ok(!state.calls.some(call => call.args.includes('--sign') || call.args.includes('staple') || call.args.includes('submit')));
});

test('a bad DMG signature blocks before mounting', async t => {
  const state = await fixture(t);
  state.signature = 'Signature=adhoc\nTeamIdentifier=not set\n';
  await assert.rejects(state.execute(), /Developer ID/);
  assert.ok(!state.calls.some(call => call.program === 'hdiutil' && call.args[0] === 'attach'));
});

test('app payload and desktop versions are independently checked against the pinned source', async t => {
  for (const field of ['packageVersion', 'desktopVersion']) {
    const state = await fixture(t);
    state[field] = '1.0.0';
    await assert.rejects(state.execute(), /version|Version/);
    assert.equal(state.calls.at(-1).args[0], 'detach');
  }
});

test('copy-only signature rejection, absent staples and architecture errors all detach the image', async t => {
  for (const fail of [
    (program, args) => program === 'codesign' && args[0] === '--verify' && args.at(-1).includes('/copy/'),
    (program, args) => program === 'xcrun' && args.at(-1).includes('/copy/'),
    program => program === 'lipo',
  ]) {
    const state = await fixture(t);
    state.fail = fail;
    await assert.rejects(state.execute(), /acceptance failure/);
    assert.equal(state.calls.at(-1).args[0], 'detach');
  }
});

test('failed detachment preserves the temporary directory instead of risking deletion through a mount', async t => {
  const state = await fixture(t);
  state.fail = (program, args) => program === 'hdiutil' && args[0] === 'detach';
  await assert.rejects(state.execute(), error => error.preserveDirectory === true && error.message.includes(state.input.root));
});
