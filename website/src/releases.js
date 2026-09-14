/* global __GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL__, __GAJAE_WEBSITE_RELEASE_TAG__ */

export const PRODUCT_NAME = 'Gajae Code App';
export const REPOSITORY_URL = 'https://github.com/devswha/gajae-code-app';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;
export const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
export const DOCS_INSTALL_URL = `${REPOSITORY_URL}/blob/main/docs/INSTALL.md`;
export const DOCS_SELF_HOST_URL = `${REPOSITORY_URL}/blob/main/docs/SELF-HOST.md`;
export const GAJAE_CODE_URL = 'https://github.com/devswha/gajae-code';
export const APPLE_GATEKEEPER_HELP_URL = 'https://support.apple.com/102445';

const CHECKED_IN_RELEASE = {
  version: '2.0.0-beta.17',
  tag: 'v2.0.0-beta.17',
  channel: 'beta',
  publishedLabel: '2026-09-14',
};

function isPublishedLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(`${value}T`);
}

export function releaseFromTag(releaseTag, publishedLabel) {
  const tag = typeof releaseTag === 'string' ? releaseTag.trim() : '';
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!match) {
    return null;
  }
  return {
    ...CHECKED_IN_RELEASE,
    version: match[1],
    tag,
    publishedLabel: isPublishedLabel(publishedLabel)
      ? publishedLabel
      : CHECKED_IN_RELEASE.publishedLabel,
  };
}

function buildReleaseOverride() {
  if (typeof __GAJAE_WEBSITE_RELEASE_TAG__ !== 'string') {
    return null;
  }
  const publishedLabel = typeof __GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL__ === 'string'
    ? __GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL__
    : undefined;
  return releaseFromTag(__GAJAE_WEBSITE_RELEASE_TAG__, publishedLabel);
}

export const RELEASE = buildReleaseOverride() ?? CHECKED_IN_RELEASE;


function releaseDownloadBase(tag = RELEASE.tag) {
  return `${RELEASES_URL}/download/${tag}`;
}

export function desktopDmgName(version = RELEASE.version) {
  return `gajae-app-desktop-${version}-macos-arm64.dmg`;
}


export function serverArchiveName(version = RELEASE.version) {
  return `gajae-app-server-${version}-linux-x64-node22.tar.gz`;
}

export function checksumName(artifactName) {
  return `${artifactName}.sha256`;
}

export function downloadUrl(fileName, tag = RELEASE.tag) {
  return `${releaseDownloadBase(tag)}/${fileName}`;
}

export function buildDownloads(release = RELEASE) {
  const dmg = desktopDmgName(release.version);
  const server = serverArchiveName(release.version);
  return {
    tagUrl: `${RELEASES_URL}/tag/${release.tag}`,
    macosArm64: {
      label: dmg,
      href: downloadUrl(dmg, release.tag),
      checksumHref: downloadUrl(checksumName(dmg), release.tag),
      checksumFile: checksumName(dmg),
      verifyCommand: `shasum -a 256 -c ${checksumName(dmg)}`,
    },
    linuxServer: {
      label: server,
      href: downloadUrl(server, release.tag),
      checksumHref: downloadUrl(checksumName(server), release.tag),
      checksumFile: checksumName(server),
      verifyCommand: `sha256sum --check ${checksumName(server)}`,
    },
  };
}

export const DOWNLOADS = buildDownloads();
