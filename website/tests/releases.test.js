import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DOWNLOADS,
  RELEASE,
  RELEASES_URL,
  buildDownloads,
  checksumName,
  desktopDmgName,
  downloadUrl,
  serverArchiveName,
} from '../src/releases.js';

/**
 * The landing page advertises the release the repository last cut, so its
 * version is read from the app rather than repeated here: a release bump that
 * forgets this page fails the gate instead of shipping stale download links.
 */
const appVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

test('pins the release the repository cut and its GitHub download URLs', () => {
  assert.equal(RELEASE.version, appVersion);
  assert.equal(RELEASE.tag, `v${appVersion}`);
  assert.equal(desktopDmgName(), `gajae-app-desktop-${appVersion}-macos-arm64.dmg`);
  assert.equal(serverArchiveName(), `gajae-app-server-${appVersion}-linux-x64-node22.tar.gz`);
  assert.equal(
    downloadUrl(desktopDmgName()),
    `${RELEASES_URL}/download/v${appVersion}/gajae-app-desktop-${appVersion}-macos-arm64.dmg`,
  );
  assert.equal(
    DOWNLOADS.macosArm64.checksumHref,
    `${RELEASES_URL}/download/v${appVersion}/${checksumName(desktopDmgName())}`,
  );
  assert.match(DOWNLOADS.macosArm64.verifyCommand, /shasum -a 256 -c /);
});

test('does not invent Windows or Intel desktop artifacts', () => {
  const downloads = buildDownloads();
  assert.equal('windows' in downloads, false);
  assert.equal('macosIntel' in downloads, false);
  assert.ok(downloads.linuxServer.href.includes('linux-x64-node22'));
});
