import fs, { promises as fsPromises } from 'node:fs';

import express from 'express';
import mime from 'mime-types';
import multer from 'multer';

import {
  buildStoredImageRecords,
  ensureImageAssetsDir,
  isAllowedImageMimeType,
  resolveImageAssetFile,
} from '@/modules/assets/services/image-assets.service.js';

const router = express.Router();

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, done) => {
      void ensureImageAssetsDir().then(
        (directory) => done(null, directory),
        (reason: Error) => done(reason, ''),
      );
    },
    filename: (_request, file, done) => {
      const identifier = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      done(null, `${identifier}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
    },
  }),
  fileFilter: (_request, file, done) => {
    if (!isAllowedImageMimeType(file.mimetype)) {
      done(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
      return;
    }
    done(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

router.post('/images', (request, response) => {
  imageUpload.array('images', 5)(request, response, (failure: unknown) => {
    if (failure) {
      response.status(400).json({ error: failure instanceof Error ? failure.message : 'Upload failed' });
      return;
    }

    const uploaded = Array.isArray(request.files) ? request.files : [];
    if (uploaded.length === 0) {
      response.status(400).json({ error: 'No image files provided' });
      return;
    }

    response.json({ images: buildStoredImageRecords(uploaded) });
  });
});

router.get('/images/:filename', async (request, response) => {
  const asset = resolveImageAssetFile(request.params.filename);
  if (asset === null) {
    response.status(400).json({ error: 'Invalid asset filename' });
    return;
  }

  try {
    await fsPromises.access(asset);
  } catch {
    response.status(404).json({ error: 'Asset not found' });
    return;
  }

  const mediaType = mime.lookup(asset) || 'application/octet-stream';
  response.setHeader('Content-Type', mediaType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (mediaType === 'image/svg+xml') {
    response.setHeader('Content-Disposition', 'attachment');
  }

  const source = fs.createReadStream(asset);
  source.pipe(response);
  source.on('error', (failure) => {
    console.error('Error streaming image asset:', failure);
    if (!response.headersSent) {
      response.status(500).json({ error: 'Error reading asset' });
    }
  });
});

export default router;
