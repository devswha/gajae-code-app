import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DESKTOP_APP_ID, PACKAGE_NAME, PRODUCT_NAME, PRODUCT_TOKEN } from '../../shared/productIdentity.js';

import { releaseCommand } from './local-release-command.mjs';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertDeveloperSignature(output, teamId, { hardened = false } = {}) {
  requireValue(!/^Signature=adhoc$/m.test(output)
    && /^Authority=Developer ID Application: .+$/m.test(output)
    && output.split(/\r?\n/).includes(`TeamIdentifier=${teamId}`), 'Expected a Developer ID Application signature from the specified team.');
  if (hardened) requireValue(/^.*flags=.+\bruntime\b.*$/m.test(output), 'App signature lacks hardened runtime.');
}

export function assertNotarizedAssessment(output) {
  requireValue(/: accepted\s*$/m.test(output) && /^source=Notarized Developer ID\s*$/m.test(output), 'Gatekeeper did not accept Notarized Developer ID.');
}

export async function verifyMacosRelease({ dmg, root, teamId, version, desktopVersion }, { run = releaseCommand } = {}) {
  const combined = async (program, args) => {
    const result = await run(program, args);
    return `${result.stdout}\n${result.stderr}`;
  };
  await run('hdiutil', ['verify', dmg]);
  await run('codesign', ['--verify', '--strict', dmg]);
  assertDeveloperSignature(await combined('codesign', ['--display', '--verbose=4', dmg]), teamId);
  await run('xcrun', ['stapler', 'validate', dmg]);
  assertNotarizedAssessment(await combined('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]));

  const mount = join(root, 'mount');
  const copyRoot = join(root, 'copy');
  await mkdir(mount);
  await mkdir(copyRoot);
  let verificationError;
  try {
    await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount]);
    const mountedApp = join(mount, `${PRODUCT_NAME}.app`);
    requireValue((await lstat(mountedApp)).isDirectory(), 'The mounted app must be a directory, not a symlink.');
    const copiedApp = join(copyRoot, `${PRODUCT_NAME}.app`);
    await run('ditto', [mountedApp, copiedApp]);
    // Only the disposable copy receives quarantine; release files stay intact.
    await run('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;GajaeLocalRelease;', copiedApp]);
    for (const app of [mountedApp, copiedApp]) {
      await run('codesign', ['--verify', '--deep', '--strict', app]);
      assertDeveloperSignature(await combined('codesign', ['--display', '--verbose=4', app]), teamId, { hardened: true });
      await run('xcrun', ['stapler', 'validate', app]);
      assertNotarizedAssessment(await combined('spctl', ['--assess', '--type', 'exec', '--verbose=2', app]));
    }
    const plist = join(copiedApp, 'Contents/Info.plist');
    for (const [key, expected] of [['CFBundleIdentifier', DESKTOP_APP_ID], ['CFBundleShortVersionString', desktopVersion]]) {
      const result = await run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, plist]);
      requireValue(result.stdout.trim() === expected, `Copied app ${key} does not match the pinned source commit.`);
    }
    const payload = JSON.parse(await readFile(join(copiedApp, 'Contents/Resources/resources/server-payload/package.json'), 'utf8'));
    requireValue(payload.name === PACKAGE_NAME && payload.version === version, 'Copied app payload version/name does not match the release tag.');
    for (const executable of [`${PRODUCT_TOKEN}-desktop`, `${PRODUCT_TOKEN}-server`]) {
      await run('lipo', [join(copiedApp, 'Contents/MacOS', executable), '-verify_arch', 'arm64']);
    }
  } catch (error) {
    verificationError = error;
  }
  try {
    await run('hdiutil', ['detach', mount]);
  } catch {
    // Never recursively remove a directory that might still be a mount.
    throw Object.assign(new Error(`Could not confirm image detachment; temporary directory retained: ${root}`), { preserveDirectory: true });
  }
  if (verificationError) throw verificationError;
}
