import assert from 'node:assert/strict';
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

test('pins the current public beta and GitHub download URLs', () => {
  assert.equal(RELEASE.version, '2.0.0-beta.3');
  assert.equal(RELEASE.tag, 'v2.0.0-beta.3');
  assert.equal(desktopDmgName(), 'gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg');
  assert.equal(serverArchiveName(), 'gajae-app-server-2.0.0-beta.3-linux-x64-node22.tar.gz');
  assert.equal(
    downloadUrl(desktopDmgName()),
    `${RELEASES_URL}/download/v2.0.0-beta.3/gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg`,
  );
  assert.equal(
    DOWNLOADS.macosArm64.checksumHref,
    `${RELEASES_URL}/download/v2.0.0-beta.3/${checksumName(desktopDmgName())}`,
  );
  assert.match(DOWNLOADS.macosArm64.verifyCommand, /shasum -a 256 -c /);
});

test('does not invent Windows or Intel desktop artifacts', () => {
  const downloads = buildDownloads();
  assert.equal('windows' in downloads, false);
  assert.equal('macosIntel' in downloads, false);
  assert.ok(downloads.linuxServer.href.includes('linux-x64-node22'));
});
