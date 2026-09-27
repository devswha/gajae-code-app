import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

import { injectLandingPage } from './src/prerender.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
const publicDir = new URL('public/', pathToFileURL(`${rootDir}/`));
const releaseTagOverride = process.env.GAJAE_WEBSITE_RELEASE_TAG?.trim() ?? '';
const releasePublishedLabelOverride =
  process.env.GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL?.trim() ?? '';

/** Renders the landing page into index.html at build (and dev) time. */
function prerenderLandingPage() {
  return {
    name: 'gajae-prerender-landing-page',
    transformIndexHtml(html) {
      return injectLandingPage(html, {
        releaseTag: releaseTagOverride,
        publishedLabel: releasePublishedLabelOverride,
        publicDir,
      });
    },
  };
}

export default defineConfig({
  root: rootDir,
  base: './',
  define: {
    __GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL__: JSON.stringify(releasePublishedLabelOverride),
    __GAJAE_WEBSITE_RELEASE_TAG__: JSON.stringify(releaseTagOverride),
  },
  plugins: [prerenderLandingPage()],
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
