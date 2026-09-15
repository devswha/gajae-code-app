import fs from 'node:fs/promises';
import path from 'node:path';

import type { Request, Response } from 'express';

import { AppError } from '../shared/utils.js';

// Bound the retained result as well as disk work. A semaphore around readdir /
// lstat alone still lets recursive Promise.all allocate a promise per entry.
const MAX_ENTRIES = 20_000;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE_SCANS = 4;
const MAX_SCAN_MS = 15_000;
const MAX_DEPTH = 10;
const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', '.parcel-cache',
  '.git', '.svn', '.hg', '.gjc-worktrees',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', 'venv', '.venv',
  'target', 'vendor', '.gradle', '.idea', 'coverage', '.nyc_output',
]);
const UNREADABLE = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR']);
let activeScans = 0;

export type ProjectFileNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
  modified: string | null;
  permissions: string;
  permissionsRwx: string;
  isSymlink?: boolean;
  children?: ProjectFileNode[];
};

type FileTreeOptions = {
  maxDepth?: number;
  showHidden?: boolean;
  directoriesOnly?: boolean;
  signal?: AbortSignal;
};

function permissionsRwx(mode: number): string {
  return [6, 3, 0].map((shift) => {
    const perm = mode >> shift;
    return `${perm & 4 ? 'r' : '-'}${perm & 2 ? 'w' : '-'}${perm & 1 ? 'x' : '-'}`;
  }).join('');
}

/** Streaming depth-first enumeration: at most one pending disk operation and
 * MAX_DEPTH + 1 buffered directory handles per scan, with no per-entry queue. */
export async function getFileTree(root: string, options: FileTreeOptions = {}): Promise<ProjectFileNode[]> {
  const { signal, showHidden = true, directoriesOnly = false } = options;
  const maxDepth = Math.max(0, Math.min(MAX_DEPTH, Math.floor(options.maxDepth ?? 3)));
  signal?.throwIfAborted();
  if (activeScans >= MAX_ACTIVE_SCANS) {
    throw new AppError('File listing is busy. Try again shortly.', { code: 'FILE_TREE_BUSY', statusCode: 503 });
  }
  activeScans++;
  const deadline = Date.now() + MAX_SCAN_MS;
  let visited = 0;
  let resultBytes = 0;
  const check = () => {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new AppError('File listing took too long. Choose a smaller project directory.', { code: 'FILE_TREE_TIMEOUT', statusCode: 503 });
    }
  };
  const tooLarge = () => new AppError('Too many project files to list. Choose a smaller project directory.', {
    code: 'FILE_TREE_TOO_LARGE', statusCode: 413,
  });

  async function visit(directory: string, depth: number): Promise<ProjectFileNode[]> {
    check();
    const items: ProjectFileNode[] = [];
    try {
      const handle = await fs.opendir(directory, { bufferSize: 32 });
      // Async iteration closes this handle on success, failure, or cancellation.
      for await (const entry of handle) {
        check();
        if (++visited > MAX_ENTRIES) throw tooLarge();
        if (!showHidden && entry.name.startsWith('.')) continue;
        if (entry.isDirectory() && (IGNORED_DIRS.has(entry.name)
          || (path.basename(directory) === '.gjc' && entry.name.startsWith('_session-')))) continue;
        if (directoriesOnly && !entry.isDirectory()) continue;
        const item: ProjectFileNode = {
          name: entry.name,
          path: path.join(directory, entry.name),
          type: entry.isDirectory() ? 'directory' : 'file',
          size: 0,
          modified: null,
          permissions: '000',
          permissionsRwx: '---------',
        };
        let descend = false;
        try {
          const stats = await fs.lstat(item.path);
          check();
          item.size = stats.size;
          item.modified = stats.mtime.toISOString();
          item.permissions = (stats.mode & 0o777).toString(8).padStart(3, '0');
          item.permissionsRwx = permissionsRwx(stats.mode);
          if (stats.isSymbolicLink()) item.isSymlink = true;
          // Do not descend into a directory replaced by a symlink after listing.
          descend = entry.isDirectory() && stats.isDirectory();
        } catch (error) {
          if (!UNREADABLE.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
        }
        // Reserve children punctuation too; the final JSON is bounded even for
        // long, escaped or multibyte paths. Never return a silently partial tree.
        resultBytes += Buffer.byteLength(JSON.stringify(item)) + 32;
        if (resultBytes > MAX_RESULT_BYTES) throw tooLarge();
        if (descend && depth < maxDepth) item.children = await visit(item.path, depth + 1);
        items.push(item);
      }
    } catch (error) {
      if (!UNREADABLE.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
    check();
    return items.sort((a, b) => a.type !== b.type
      ? a.type === 'directory' ? -1 : 1
      : a.name.localeCompare(b.name));
  }

  try {
    return await visit(root, 0);
  } finally {
    activeScans--;
  }
}

/** A GET request's incoming `close` can mean its body completed normally.
 * Response close / request aborted identify a disconnected listing consumer. */
export function fileTreeRequest(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose() {
      req.off('aborted', abort);
      res.off('close', abort);
    },
  };
}
