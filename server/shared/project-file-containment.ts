import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

function isWithinProjectRoot(projectRootRealPath: string, candidateRealPath: string): boolean {
  return (
    candidateRealPath === projectRootRealPath
    || candidateRealPath.startsWith(`${projectRootRealPath}${path.sep}`)
  );
}

async function resolveNearestExistingAncestor(filePath: string): Promise<{
  path: string;
  missingPathSegments: string[];
} | null> {
  let candidate = filePath;
  const missingPathSegments: string[] = [];

  while (true) {
    try {
      await lstat(candidate);
      return { path: candidate, missingPathSegments };
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== 'ENOENT') {
        throw error;
      }

      const parent = path.dirname(candidate);
      if (parent === candidate) {
        return null;
      }

      missingPathSegments.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Resolves an existing file for reading and rejects symlinks that leave the
 * project's real root. The returned path is canonical so the caller reads the
 * same path that was checked.
 */
export async function resolveProjectFileForRead(
  projectRoot: string,
  filePath: string,
): Promise<string | null> {
  const [projectRootRealPath] = await Promise.all([
    realpath(projectRoot),
    lstat(filePath),
  ]);
  const fileRealPath = await realpath(filePath);

  return isWithinProjectRoot(projectRootRealPath, fileRealPath) ? fileRealPath : null;
}

/**
 * Resolves a path for mutation. Existing paths are canonicalized directly;
 * for new paths, the closest existing ancestor is canonicalized and the
 * missing suffix is appended. This rejects dangling symlinks and symlink
 * ancestors that resolve outside the project's real root.
 */
export async function resolveProjectFileForWrite(
  projectRoot: string,
  filePath: string,
): Promise<string | null> {
  const projectRootRealPath = await realpath(projectRoot);
  const ancestor = await resolveNearestExistingAncestor(filePath);
  if (!ancestor) {
    return null;
  }

  let ancestorRealPath: string;
  try {
    ancestorRealPath = await realpath(ancestor.path);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const fileRealPath = path.join(ancestorRealPath, ...ancestor.missingPathSegments);
  return isWithinProjectRoot(projectRootRealPath, fileRealPath) ? fileRealPath : null;
}

/**
 * Resolves an existing directory entry without dereferencing its leaf. This is
 * for rename/delete, where a symlink entry itself must be mutated rather than
 * the file or directory it points to.
 */
export async function resolveProjectEntryForMutation(
  projectRoot: string,
  entryPath: string,
): Promise<string | null> {
  const projectRootRealPath = await realpath(projectRoot);
  const absoluteEntryPath = path.isAbsolute(entryPath)
    ? path.resolve(entryPath)
    : path.resolve(projectRoot, entryPath);
  const parentRealPath = await realpath(path.dirname(absoluteEntryPath));
  if (!isWithinProjectRoot(projectRootRealPath, parentRealPath)) {
    return null;
  }

  return path.join(parentRealPath, path.basename(absoluteEntryPath));
}

export async function openProjectFileForWrite(
  projectRoot: string,
  filePath: string,
): Promise<{ handle: Awaited<ReturnType<typeof open>>; path: string } | null> {
  const canonicalPath = await resolveProjectFileForWrite(projectRoot, filePath);
  if (!canonicalPath) {
    return null;
  }

  let expectedStats;
  try {
    expectedStats = await lstat(canonicalPath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!expectedStats.isFile() || expectedStats.isSymbolicLink()) {
    return null;
  }

  const handle = await open(
    canonicalPath,
    constants.O_RDWR | (constants.O_NOFOLLOW || 0),
  );
  const openedStats = await handle.stat();
  if (
    !openedStats.isFile()
    || openedStats.dev !== expectedStats.dev
    || openedStats.ino !== expectedStats.ino
  ) {
    await handle.close();
    return null;
  }

  return { handle, path: canonicalPath };
}
