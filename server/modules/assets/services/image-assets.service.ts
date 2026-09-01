import { promises as filesystem } from 'node:fs';
import path from 'node:path';

import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';

type StoredImageAsset = { name: string; path: string; size: number; mimeType: string };
type UploadedImageFile = { originalname: string; filename: string; size: number; mimetype: string };

export function isAllowedImageMimeType(mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/png':
    case 'image/gif':
    case 'image/webp':
    case 'image/svg+xml':
      return true;
    default:
      return false;
  }
}

export async function ensureImageAssetsDir(): Promise<string> {
  const directory = getGlobalImageAssetsDir();
  await filesystem.mkdir(directory, { recursive: true });
  return directory;
}

export function buildStoredImageRecords(files: UploadedImageFile[]): StoredImageAsset[] {
  const directory = getGlobalImageAssetsDir();
  const records: StoredImageAsset[] = [];
  for (const upload of files) {
    records.push({
      name: upload.originalname,
      path: toPosixPath(path.join(directory, upload.filename)),
      size: upload.size,
      mimeType: upload.mimetype,
    });
  }
  return records;
}

export function resolveImageAssetFile(filename: string): string | null {
  const basename = typeof filename === 'string' ? filename.trim() : '';
  if (basename === '' || basename.includes('..')) {
    return null;
  }
  if (/[\\/]/.test(basename)) {
    return null;
  }

  const directory = path.resolve(getGlobalImageAssetsDir());
  const asset = path.resolve(directory, basename);
  return path.dirname(asset) === directory ? asset : null;
}
