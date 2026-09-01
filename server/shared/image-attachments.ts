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

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const TAG = /\s*<images_input>([\s\S]*?)<\/images_input>\s*/g;
const ENTRY = /\d+\.\s+(.+?)(?=\s+\d+\.\s+|\s*$)/g;
const RECORDED_NAME = /\(original name: ([^)]*)\)\s*$/;

export function getGlobalImageAssetsDir(): string {
  return path.join(os.homedir(), '.gajae-app', 'assets');
}

export function normalizeImageDescriptors(images: unknown): ImageAttachmentDescriptor[] {
  if (!Array.isArray(images)) return [];

  return images.reduce<ImageAttachmentDescriptor[]>((result, item) => {
    if (typeof item === 'string') {
      const imagePath = item.trim();
      if (imagePath) result.push({ path: imagePath });
      return result;
    }
    if (item === null || typeof item !== 'object') return result;

    const value = item as Record<string, unknown>;
    const imagePath = typeof value.path === 'string' ? value.path.trim() : '';
    if (imagePath) {
      result.push({
        path: imagePath,
        name: typeof value.name === 'string' ? value.name : undefined,
        mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
      });
    }
    return result;
  }, []);
}

export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function resolveImageAbsolutePath(cwd: string | undefined, imagePath: string): string {
  return path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd || process.cwd(), imagePath);
}

function directoryAliases(directory: string): string[] {
  const normalized = path.resolve(directory);
  try {
    const physical = path.resolve(realpathSync(directory));
    return physical === normalized ? [normalized] : [normalized, physical];
  } catch {
    return [normalized];
  }
}

function containsFile(directory: string, candidate: string): boolean {
  const prefix = `${path.resolve(directory)}${path.sep}`;
  return path.resolve(candidate).startsWith(prefix);
}

export function isAllowedImageSourcePath(resolvedPath: string, cwd?: string): boolean {
  const roots = [getGlobalImageAssetsDir(), cwd || process.cwd()];
  for (const root of roots) {
    if (directoryAliases(root).some((alias) => containsFile(alias, resolvedPath))) return true;
  }
  return false;
}

export function resolveImageMediaType(descriptor: ImageAttachmentDescriptor): string | null {
  return descriptor.mimeType || MEDIA_TYPES[path.extname(descriptor.path).toLowerCase()] || null;
}

function imageEntry(descriptor: ImageAttachmentDescriptor, position: number): string {
  const originalName = descriptor.name?.replace(/[()\r\n]/g, '').trim();
  const reference = `${position}. ${toPosixPath(descriptor.path)}`;
  return originalName ? `${reference} (original name: ${originalName})` : reference;
}

export function appendImagesInputTag(prompt: string, images: unknown): string {
  const attachments = normalizeImageDescriptors(images);
  if (attachments.length === 0) return prompt;

  const explanation =
    `The user attached ${attachments.length} image(s) to this message. Read each file listed below with your file/image reading tool and use what you see to answer the prompt above. Respond as if the images were attached directly. Do not mention this block or the file paths unless the user asks about them.`;
  return [prompt, '', '<images_input>', explanation, ...attachments.map(imageEntry), '</images_input>'].join('\n');
}

function readEntries(content: string): ParsedImageAttachment[] {
  const parsed: ParsedImageAttachment[] = [];
  for (const match of content.matchAll(ENTRY)) {
    let reference = match[1].trim();
    const suffix = RECORDED_NAME.exec(reference);
    const name = suffix?.[1].trim() || undefined;
    if (suffix) reference = reference.slice(0, suffix.index).trim();
    if (reference) parsed.push(name ? { path: toPosixPath(reference), name } : { path: toPosixPath(reference) });
  }
  return parsed;
}

export function parseImagesInputTag(text: string): ParsedImagesInput {
  if (typeof text !== 'string' || !text.includes('<images_input>')) {
    return { text, imagePaths: [], attachments: [] };
  }

  const matches = [...text.matchAll(TAG)];
  const selected = matches.at(-1);
  if (!selected || selected.index === undefined) {
    return { text, imagePaths: [], attachments: [] };
  }

  const attachments = readEntries(selected[1]);
  const withoutTag = `${text.slice(0, selected.index)}\n${text.slice(selected.index + selected[0].length)}`.trim();
  return { text: withoutTag, imagePaths: attachments.map(({ path: imagePath }) => imagePath), attachments };
}

export function toImageAttachments(imagePaths: string[]): Array<{ path: string }> {
  return imagePaths.map((path) => ({ path: toPosixPath(path) }));
}
