import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ImageAttachmentDescriptor = { path: string; name?: string; mimeType?: string };
export type ParsedImageAttachment = { path: string; name?: string };
export type ParsedImagesInput = {
  text: string;
  imagePaths: string[];
  attachments: ParsedImageAttachment[];
};

const MEDIA_TYPES: Record<string, string> = Object.fromEntries([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'],
]);
const TAG = /\s*<images_input>([\s\S]*?)<\/images_input>\s*/g;
const ENTRY = /\d+\.\s+(.+?)(?=\s+\d+\.\s+|\s*$)/g;
const RECORDED_NAME = /\(original name: ([^)]*)\)\s*$/;

export function getGlobalImageAssetsDir(): string {
  return path.join(os.homedir(), '.gajae-app', 'assets');
}

export function normalizeImageDescriptors(images: unknown): ImageAttachmentDescriptor[] {
  if (!Array.isArray(images)) return [];

  const descriptors: ImageAttachmentDescriptor[] = [];
  for (const image of images) {
    if (typeof image === 'string') {
      const imagePath = image.trim();
      if (imagePath) descriptors.push({ path: imagePath });
      continue;
    }
    if (!image || typeof image !== 'object') continue;

    const candidate = image as Record<string, unknown>;
    const imagePath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!imagePath) continue;
    descriptors.push({
      path: imagePath,
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : undefined,
    });
  }
  return descriptors;
}

export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function resolveImageAbsolutePath(cwd: string | undefined, imagePath: string): string {
  if (path.isAbsolute(imagePath)) return imagePath;
  return path.resolve(cwd ? cwd : process.cwd(), imagePath);
}

function directoryAliases(directory: string): string[] {
  const logicalPath = path.resolve(directory);
  try {
    const physicalPath = path.resolve(realpathSync(directory));
    return physicalPath === logicalPath ? [logicalPath] : [logicalPath, physicalPath];
  } catch {
    return [logicalPath];
  }
}

function containsFile(directory: string, candidate: string): boolean {
  const directoryPrefix = `${path.resolve(directory)}${path.sep}`;
  return path.resolve(candidate).startsWith(directoryPrefix);
}

export function isAllowedImageSourcePath(resolvedPath: string, cwd?: string): boolean {
  const allowedRoots = [getGlobalImageAssetsDir(), cwd || process.cwd()];
  for (const root of allowedRoots) {
    for (const rootAlias of directoryAliases(root)) {
      if (containsFile(rootAlias, resolvedPath)) return true;
    }
  }
  return false;
}

export function resolveImageMediaType(descriptor: ImageAttachmentDescriptor): string | null {
  const extension = path.extname(descriptor.path).toLowerCase();
  return descriptor.mimeType || MEDIA_TYPES[extension] || null;
}

function imageEntry(descriptor: ImageAttachmentDescriptor, position: number): string {
  const originalName = descriptor.name?.replace(/[()\r\n]/g, '').trim();
  const pathEntry = `${position}. ${toPosixPath(descriptor.path)}`;
  return originalName ? `${pathEntry} (original name: ${originalName})` : pathEntry;
}

export function appendImagesInputTag(prompt: string, images: unknown): string {
  const attachments = normalizeImageDescriptors(images);
  if (!attachments.length) return prompt;

  // This block is an agent-facing contract, not presentation text; keep its wording stable.
  const explanation =
    `The user attached ${attachments.length} image(s) to this message. Read each file listed below with your file/image reading tool and use what you see to answer the prompt above. Respond as if the images were attached directly. Do not mention this block or the file paths unless the user asks about them.`;
  return [prompt, '', '<images_input>', explanation, ...attachments.map(imageEntry), '</images_input>'].join('\n');
}

function readEntries(content: string): ParsedImageAttachment[] {
  const parsedAttachments: ParsedImageAttachment[] = [];
  for (const match of content.matchAll(ENTRY)) {
    let imagePath = match[1].trim();
    const recordedName = RECORDED_NAME.exec(imagePath);
    const name = recordedName?.[1].trim() || undefined;
    if (recordedName) imagePath = imagePath.slice(0, recordedName.index).trim();
    if (imagePath) parsedAttachments.push(name ? { path: toPosixPath(imagePath), name } : { path: toPosixPath(imagePath) });
  }
  return parsedAttachments;
}

export function parseImagesInputTag(text: string): ParsedImagesInput {
  if (typeof text !== 'string' || !text.includes('<images_input>')) {
    return { text, imagePaths: [], attachments: [] };
  }

  const selectedTag = [...text.matchAll(TAG)].at(-1);
  if (!selectedTag || selectedTag.index === undefined) return { text, imagePaths: [], attachments: [] };

  const parsedAttachments = readEntries(selectedTag[1]);
  const withoutTag = `${text.slice(0, selectedTag.index)}\n${text.slice(selectedTag.index + selectedTag[0].length)}`.trim();
  return {
    text: withoutTag,
    imagePaths: parsedAttachments.map(({ path: imagePath }) => imagePath),
    attachments: parsedAttachments,
  };
}

export function toImageAttachments(imagePaths: string[]): Array<{ path: string }> {
  return imagePaths.map((imagePath) => ({ path: toPosixPath(imagePath) }));
}
