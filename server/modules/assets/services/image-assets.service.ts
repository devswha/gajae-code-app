import { promises as fileSystem } from 'node:fs';
import nodePath from 'node:path';

import { getGlobalImageAssetsDir as assetsDirectory, toPosixPath as posixPath } from '@/shared/image-attachments.js';

type StoredImageAsset = { name: string; path: string; size: number; mimeType: string };
type UploadedImageFile = { originalname: string; filename: string; size: number; mimetype: string };

const IMAGE_MIME_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/gif': true,
  'image/webp': true,
  'image/svg+xml': true,
};

export function isAllowedImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES[mimeType] === true;
}

export async function ensureImageAssetsDir(): Promise<string> {
  const directory = assetsDirectory();
  await fileSystem.mkdir(directory, { recursive: true });
  return directory;
}

export function buildStoredImageRecords(files: UploadedImageFile[]): StoredImageAsset[] {
  const directory = assetsDirectory();
  return files.map(({ originalname, filename, size, mimetype }) => ({
    name: originalname,
    path: posixPath(nodePath.join(directory, filename)),
    size,
    mimeType: mimetype,
  }));
}

export function resolveImageAssetFile(filename: string): string | null {
  const name = typeof filename === 'string' ? filename.trim() : '';
  // Route parameters identify a file, never a path below the asset root.
  if (!name || name.includes('..') || /[\\/\0]/.test(name)) return null;

  const directory = nodePath.resolve(assetsDirectory());
  const assetPath = nodePath.resolve(directory, name);
  return nodePath.dirname(assetPath) === directory ? assetPath : null;
}
