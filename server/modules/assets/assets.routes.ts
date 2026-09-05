import { randomUUID } from 'node:crypto';
import { constants, promises as fsPromises } from 'node:fs';

import express from 'express';
import mime from 'mime-types';
import multer from 'multer';

import {
  buildStoredImageRecords, ensureImageAssetsDir,
  isAllowedImageMimeType, resolveImageAssetFile,
} from '@/modules/assets/services/image-assets.service.js';

const assetsRouter = express.Router();

function generatedFilename(mimeType: string): string {
  // The original extension is untrusted: an allowed image MIME with an HTML
  // filename must never become an executable document on the app's origin.
  return `${randomUUID()}.${mime.extension(mimeType)}`;
}

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, done) => {
      void ensureImageAssetsDir().then(
        (directory) => done(null, directory),
        (reason: Error) => done(reason, ''),
      );
    },
    filename: (_request, file, done) => done(null, generatedFilename(file.mimetype)),
  }),
  fileFilter: (_request, file, done) => {
    if (!isAllowedImageMimeType(file.mimetype)) {
      return done(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
    }
    done(null, true);
  },
  limits: { files: 5, fileSize: 5 * 1024 * 1024 },
});

assetsRouter.post('/images', (request, response) => {
  imageUpload.array('images', 5)(request, response, (failure: unknown) => {
    if (failure) {
      const error = failure instanceof Error ? failure.message : 'Upload failed';
      response.status(400).json({ error });
      return;
    }

    const files = Array.isArray(request.files) ? request.files : [];
    if (!files.length) {
      response.status(400).json({ error: 'No image files provided' });
      return;
    }
    response.json({ images: buildStoredImageRecords(files) });
  });
});

assetsRouter.get('/images/:filename', async (request, response) => {
  const filename = resolveImageAssetFile(request.params.filename);
  if (filename === null) {
    response.status(400).json({ error: 'Invalid asset filename' });
    return;
  }

  let asset;
  try {
    // Reject non-files before opening (including FIFOs), then verify the opened
    // descriptor. O_NOFOLLOW also closes a final-component symlink swap race.
    if (!(await fsPromises.lstat(filename)).isFile()) {
      response.status(404).json({ error: 'Asset not found' });
      return;
    }
    asset = await fsPromises.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!(await asset.stat()).isFile()) {
      await asset.close();
      response.status(404).json({ error: 'Asset not found' });
      return;
    }
  } catch {
    await asset?.close().catch(() => {});
    response.status(404).json({ error: 'Asset not found' });
    return;
  }

  const detectedType = mime.lookup(filename);
  const contentType = detectedType && isAllowedImageMimeType(detectedType) ? detectedType : 'application/octet-stream';
  response.setHeader('Content-Type', contentType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (contentType === 'image/svg+xml' || contentType === 'application/octet-stream') {
    response.setHeader('Content-Disposition', 'attachment');
  }

  const assetStream = asset.createReadStream();
  response.once('close', () => assetStream.destroy());
  assetStream.on('error', (failure) => {
    console.error('Error streaming image asset:', failure);
    if (!response.headersSent) response.status(500).json({ error: 'Error reading asset' });
    else response.destroy();
  });
  assetStream.pipe(response);
});

export default assetsRouter;
