import { strict as check } from 'node:assert';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as specification } from 'node:test';

import {
  buildStoredImageRecords as makeStoredRecords,
  isAllowedImageMimeType as acceptsImageMimeType,
  resolveImageAssetFile as findStoredAsset,
} from '@/modules/assets/services/image-assets.service.js';

const gajaeAssetRoot = join(homedir(), '.gajae-app', 'assets');

specification('upload validation admits image payloads while rejecting non-image content', () => {
  const mediaTypePolicy = [
    ['image/png', true],
    ['image/svg+xml', true],
    ['application/pdf', false],
    ['text/html', false],
  ] as const;

  for (const [mediaType, permitted] of mediaTypePolicy) {
    check.equal(acceptsImageMimeType(mediaType), permitted, mediaType);
  }
});

specification('upload records retain client metadata and resolve beneath the application asset store', () => {
  const uploads = [
    { originalname: 'gajae-overview.png', filename: 'asset-2026-overview.png', size: 4_096, mimetype: 'image/png' },
  ];
  const record = makeStoredRecords(uploads).at(0);

  check.deepEqual(record, {
    name: 'gajae-overview.png',
    path: `${gajaeAssetRoot.replace(/\\/g, '/')}/asset-2026-overview.png`,
    size: 4_096,
    mimeType: 'image/png',
  });
});

specification('asset retrieval only permits a single nonblank stored filename', () => {
  const storedFile = 'asset-2026-overview.png';
  check.equal(findStoredAsset(storedFile), join(resolve(gajaeAssetRoot), storedFile));

  const nonBasenames = ['', '   ', '../auth.db', '..', 'attachments/asset.png', 'attachments\\asset.png', 'a..b/../asset.png'];
  for (const candidate of nonBasenames) {
    check.equal(findStoredAsset(candidate), null, candidate);
  }
});
