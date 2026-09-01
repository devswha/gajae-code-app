import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildStoredImageRecords,
  isAllowedImageMimeType,
  resolveImageAssetFile,
} from '@/modules/assets/services/image-assets.service.js';

const assetsDirectory = path.join(os.homedir(), '.gajae-app', 'assets');

test('image uploads allow the supported image media types but not document or markup types', () => {
  const expected = new Map([
    ['image/png', true],
    ['image/svg+xml', true],
    ['application/pdf', false],
    ['text/html', false],
  ]);
  for (const [mimeType, allowed] of expected) {
    assert.equal(isAllowedImageMimeType(mimeType), allowed);
  }
});

test('stored upload metadata preserves fields and anchors its path in global assets', () => {
  const [record] = buildStoredImageRecords([
    { originalname: 'shot.png', filename: '123-456-shot.png', size: 42, mimetype: 'image/png' },
  ]);
  assert.deepEqual(record, {
    name: 'shot.png',
    path: `${assetsDirectory.replace(/\\/g, '/')}/123-456-shot.png`,
    size: 42,
    mimeType: 'image/png',
  });
});

test('asset file lookup accepts a basename and excludes empty or path-shaped values', () => {
  assert.equal(resolveImageAssetFile('123-shot.png'), path.join(path.resolve(assetsDirectory), '123-shot.png'));
  for (const unsafeName of ['', '   ', '../auth.db', '..', 'sub/dir.png', 'sub\\dir.png', 'a..b/../c.png']) {
    assert.equal(resolveImageAssetFile(unsafeName), null);
  }
});
