import assert from 'node:assert/strict';
import test from 'node:test';

import { renderLandingPage } from '../src/page.js';
import { APPLE_GATEKEEPER_HELP_URL, DOWNLOADS, RELEASE } from '../src/releases.js';

test('landing page exposes the pinned GitHub download buttons', () => {
  const html = renderLandingPage();
  assert.match(html, /id="download"/);
  assert.match(html, new RegExp(DOWNLOADS.macosArm64.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(DOWNLOADS.linuxServer.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /Download for Mac/);
  assert.equal(html.includes('Windows용 내려받기'), false);
  assert.equal(html.includes('Download for Windows'), false);
  assert.equal(html.includes('/latest/download/'), false);
  assert.match(html, new RegExp(RELEASE.tag.replace('.', '\\.')));
});

test('explains the unnotarized macOS beta before download', () => {
  const html = renderLandingPage();
  assert.match(html, /Public beta · Apple notarization pending/);
  assert.match(html, /System Settings → Privacy &amp; Security → Open Anyway/);
  assert.match(html, new RegExp(APPLE_GATEKEEPER_HELP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /aria-describedby="macos-beta-notice"/);
  assert.match(html, /id="macos-install"/);
});
