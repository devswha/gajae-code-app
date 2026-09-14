import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const releaseTagOverride = process.env.GAJAE_WEBSITE_RELEASE_TAG?.trim() ?? '';
const releasePublishedLabelOverride =
  process.env.GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL?.trim() ?? '';

export default defineConfig({
  root: rootDir,
  base: './',
  define: {
    __GAJAE_WEBSITE_RELEASE_PUBLISHED_LABEL__: JSON.stringify(releasePublishedLabelOverride),
    __GAJAE_WEBSITE_RELEASE_TAG__: JSON.stringify(releaseTagOverride),
  },
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
