import { useEffect, useState } from 'react';

import { version } from '../../package.json';
import type { ReleaseInfo } from '../types/sharedTypes';

const RELEASE_CHECK_DELAY = 5 * 60 * 1000;

function compareVersions(first: string, second: string): number {
  const firstParts = first.split('.').map(Number);
  const secondParts = second.split('.').map(Number);
  const partCount = Math.max(firstParts.length, secondParts.length);

  for (let index = 0; index < partCount; index += 1) {
    const difference = (firstParts[index] || 0) - (secondParts[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

export const useVersionCheck = (owner: string, repo: string) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    const clearRelease = () => {
      setUpdateAvailable(false);
      setLatestVersion(null);
      setReleaseInfo(null);
    };

    const refreshRelease = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
        const release = await response.json();
        if (!release.tag_name) {
          clearRelease();
          return;
        }

        const tag = release.tag_name.replace(/^v/, '');
        setLatestVersion(tag);
        setUpdateAvailable(compareVersions(tag, version) > 0);
        setReleaseInfo({
          title: release.name || release.tag_name,
          body: release.body || '',
          htmlUrl: release.html_url || `https://github.com/${owner}/${repo}/releases/latest`,
          publishedAt: release.published_at,
        });
      } catch (error) {
        console.error('Version check failed:', error);
        clearRelease();
      }
    };

    void refreshRelease();
    const timer = window.setInterval(refreshRelease, RELEASE_CHECK_DELAY);
    return () => window.clearInterval(timer);
  }, [owner, repo]);

  return { updateAvailable, latestVersion, currentVersion: version, releaseInfo };
};
