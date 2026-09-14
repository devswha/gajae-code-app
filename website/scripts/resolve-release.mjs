import { appendFileSync } from 'node:fs';

import { RELEASE, REPOSITORY_URL, releaseFromTag } from '../src/releases.js';

const MAX_RELEASE_PAGES = 5;
const RELEASES_PER_PAGE = 100;

export function repositoryFromUrl(repositoryUrl = REPOSITORY_URL) {
  const repository = new URL(repositoryUrl).pathname.replace(/^\/+/, '');
  if (!repository) {
    throw new Error(`Could not parse repository from ${repositoryUrl}`);
  }
  return repository;
}

export function requiredReleaseAssets(version) {
  const appArchive = `gajae-app-desktop-${version}-macos-arm64.app.tar.gz`;
  const dmg = `gajae-app-desktop-${version}-macos-arm64.dmg`;
  const server = `gajae-app-server-${version}-linux-x64-node22.tar.gz`;
  return [
    'desktop-update.json',
    appArchive,
    `${appArchive}.sha256`,
    `${appArchive}.sig`,
    dmg,
    `${dmg}.sha256`,
    server,
    `${server}.sha256`,
  ];
}

function publishedLabelFromTimestamp(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function fetchJson(url, { fetchImpl, token }) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'gajae-code-app-website-release-resolver',
    'x-github-api-version': '2022-11-28',
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${url}`);
  }
  return response.json();
}

async function findNewestNonDraftRelease({ fetchImpl, repository, token }) {
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const releases = await fetchJson(
      `https://api.github.com/repos/${repository}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
      { fetchImpl, token },
    );
    if (!Array.isArray(releases)) {
      throw new Error('GitHub API did not return a release list.');
    }
    const release = releases.find((candidate) => !candidate.draft);
    if (release) {
      return release;
    }
    if (releases.length < RELEASES_PER_PAGE) {
      break;
    }
  }
  throw new Error('No non-draft GitHub release was found.');
}

export async function resolveWebsiteReleaseTag({
  fallbackPublishedLabel = RELEASE.publishedLabel,
  fallbackTag = RELEASE.tag,
  fetchImpl = fetch,
  log = console.log,
  repository = repositoryFromUrl(),
  token,
} = {}) {
  try {
    const release = await findNewestNonDraftRelease({ fetchImpl, repository, token });
    const releaseMetadata = releaseFromTag(release.tag_name);
    if (!releaseMetadata) {
      throw new Error(`Release tag is not supported by the website: ${release.tag_name}`);
    }
    const releasePublishedLabel = publishedLabelFromTimestamp(release.published_at);
    if (!releasePublishedLabel) {
      throw new Error(`Release ${release.tag_name} has no valid published_at timestamp.`);
    }

    const required = requiredReleaseAssets(releaseMetadata.version);
    const assets = new Set((release.assets ?? []).map((asset) => asset.name));
    const missing = required.filter((assetName) => !assets.has(assetName));
    if (missing.length > 0) {
      throw new Error(`${release.tag_name} is missing assets: ${missing.join(', ')}`);
    }

    log(`Using latest non-draft release ${release.tag_name} for website downloads.`);
    log(`Verified release assets: ${required.join(', ')}`);
    return {
      releasePublishedLabel,
      releaseTag: release.tag_name,
      usedFallback: false,
    };
  } catch (error) {
    log(`Keeping checked-in website release pin ${fallbackTag}: ${error.message}`);
    return {
      releasePublishedLabel: fallbackPublishedLabel,
      releaseTag: fallbackTag,
      usedFallback: true,
      reason: error.message,
    };
  }
}

export async function main({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const { releasePublishedLabel, releaseTag } = await resolveWebsiteReleaseTag({
    fetchImpl,
    log,
    token: env.GITHUB_TOKEN,
  });
  if (!env.GITHUB_OUTPUT) {
    throw new Error('GITHUB_OUTPUT is not set.');
  }
  appendFileSync(
    env.GITHUB_OUTPUT,
    `release_tag=${releaseTag}\nrelease_published_label=${releasePublishedLabel}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
