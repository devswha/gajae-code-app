import { existsSync, readFileSync } from 'node:fs';

import { renderLandingPage } from './page.js';
import { RELEASE, releaseFromTag } from './releases.js';

export const LANDING_PAGE_MARKER = '<!--landing-page-->';

/**
 * Reads the film's chapter cards from public/media/film/chapters.json, when the film has
 * been rendered. The page shows them as seek points in the film player. A missing or
 * malformed file means no chapter list, never a failed build.
 */
export function readFilmChapters(publicDir) {
  const file = new URL('media/film/chapters.json', publicDir);
  if (!existsSync(file)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.chapters;
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter((chapter) => Number.isFinite(chapter?.t) && typeof chapter?.title === 'string')
      .map((chapter) => ({ t: Math.max(0, chapter.t), title: chapter.title.trim() }))
      .filter((chapter) => chapter.title.length > 0);
  } catch {
    return [];
  }
}

/**
 * Injects the rendered landing page into index.html at build time, so the content paints
 * without JavaScript. The release follows the same build-time override the client used to
 * read (GAJAE_WEBSITE_RELEASE_TAG / _PUBLISHED_LABEL), falling back to the checked-in pin.
 */
export function injectLandingPage(html, { releaseTag = '', publishedLabel = '', publicDir } = {}) {
  if (!html.includes(LANDING_PAGE_MARKER)) {
    throw new Error(`index.html is missing the ${LANDING_PAGE_MARKER} marker`);
  }
  const release = releaseFromTag(releaseTag, publishedLabel) ?? RELEASE;
  const filmChapters = publicDir ? readFilmChapters(publicDir) : [];
  return html.replace(LANDING_PAGE_MARKER, () => renderLandingPage({ release, filmChapters }));
}
