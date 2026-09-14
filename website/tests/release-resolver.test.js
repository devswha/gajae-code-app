import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  main,
  repositoryFromUrl,
  requiredReleaseAssets,
  resolveWebsiteReleaseTag,
} from '../scripts/resolve-release.mjs';
import { RELEASE, REPOSITORY_URL } from '../src/releases.js';

function releaseAssetList(version, except = []) {
  const excluded = new Set(except);
  return requiredReleaseAssets(version)
    .filter((name) => !excluded.has(name))
    .map((name) => ({ name }));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('parses the website release repository from the public GitHub URL', () => {
  assert.equal(repositoryFromUrl(REPOSITORY_URL), 'devswha/gajae-code-app');
});

test('resolves the first non-draft release when all expected assets exist', async () => {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse([
      { draft: true, tag_name: 'v9.9.9-draft', assets: [] },
      {
        draft: false,
        tag_name: 'v2.0.0-beta.99',
        published_at: '2031-01-02T23:45:00Z',
        assets: releaseAssetList('2.0.0-beta.99'),
      },
    ]);
  };

  const result = await resolveWebsiteReleaseTag({
    fallbackTag: RELEASE.tag,
    fetchImpl,
    log: (message) => logs.push(message),
    repository: 'devswha/gajae-code-app',
    token: 'workflow-token',
  });

  assert.deepEqual(result, {
    releasePublishedLabel: '2031-01-02',
    releaseTag: 'v2.0.0-beta.99',
    usedFallback: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/devswha/gajae-code-app/releases?per_page=100&page=1',
  );
  assert.equal(calls[0].options.headers.authorization, 'Bearer workflow-token');
  assert.ok(logs.some((message) => message.includes('Using latest non-draft release v2.0.0-beta.99')));
  assert.ok(logs.some((message) => message.includes('Verified release assets:')));
});

test('falls back to the checked-in pin when release asset verification fails', async () => {
  const missingAsset = 'gajae-app-desktop-2.0.0-beta.99-macos-arm64.dmg.sha256';
  const logs = [];
  const result = await resolveWebsiteReleaseTag({
    fallbackTag: RELEASE.tag,
    fetchImpl: async () => jsonResponse([
      {
        draft: false,
        tag_name: 'v2.0.0-beta.99',
        published_at: '2031-01-02T23:45:00Z',
        assets: releaseAssetList('2.0.0-beta.99', [missingAsset]),
      },
    ]),
    log: (message) => logs.push(message),
    repository: 'devswha/gajae-code-app',
  });

  assert.equal(result.releaseTag, RELEASE.tag);
  assert.equal(result.usedFallback, true);
  assert.match(result.reason, /missing assets/);
  assert.match(result.reason, new RegExp(missingAsset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(logs.some((message) => message.startsWith('Keeping checked-in website release pin')));
});

test('writes the resolved tag and UTC publish date to the workflow output', async (context) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'gajae-website-release-'));
  context.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const outputPath = join(outputDirectory, 'github-output');

  await main({
    env: {
      GITHUB_OUTPUT: outputPath,
      GITHUB_TOKEN: 'workflow-token',
    },
    fetchImpl: async () => jsonResponse([
      {
        draft: false,
        tag_name: 'v2.0.0-beta.99',
        published_at: '2031-01-03T01:00:00+02:00',
        assets: releaseAssetList('2.0.0-beta.99'),
      },
    ]),
    log: () => {},
  });

  assert.equal(
    await readFile(outputPath, 'utf8'),
    'release_tag=v2.0.0-beta.99\nrelease_published_label=2031-01-02\n',
  );
});

test('falls back when the release tag is not supported by the website bundle', async () => {
  const logs = [];
  const result = await resolveWebsiteReleaseTag({
    fallbackTag: RELEASE.tag,
    fetchImpl: async () => jsonResponse([
      {
        draft: false,
        tag_name: 'vpreview',
        assets: releaseAssetList('preview'),
      },
    ]),
    log: (message) => logs.push(message),
    repository: 'devswha/gajae-code-app',
  });

  assert.equal(result.releaseTag, RELEASE.tag);
  assert.equal(result.usedFallback, true);
  assert.match(result.reason, /not supported by the website/);
  assert.ok(logs.some((message) => message.startsWith('Keeping checked-in website release pin')));
});

test('falls back to the checked-in pin when the GitHub API request fails', async () => {
  const result = await resolveWebsiteReleaseTag({
    fallbackTag: RELEASE.tag,
    fetchImpl: async () => jsonResponse({ message: 'server error' }, 500),
    log: () => {},
    repository: 'devswha/gajae-code-app',
  });

  assert.equal(result.releaseTag, RELEASE.tag);
  assert.equal(result.usedFallback, true);
  assert.match(result.reason, /GitHub API returned 500/);
});
