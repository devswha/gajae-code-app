/**
 * Runs a packaged artifact from a location where nothing can be resolved from
 * this repository.
 *
 * Node's and Bun's module resolution walk up from the importing file through
 * every ancestor `node_modules`. An artifact that sits inside this checkout
 * (`src-tauri/target/…`, `src-tauri/resources/server-payload`,
 * `release/server/.stage-*`) therefore has the repository's own dependency
 * tree as a silent fallback: a package the build removed still resolves, and
 * the smoke passes while the shipped copy is broken. That is exactly how the
 * `elkjs` exclusion reached a notarized DMG before it was noticed.
 *
 * The copy goes to the OS temp directory, and the destination is checked for
 * the same hazard before anything runs there.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function isDirectory(candidate) {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/** The nearest ancestor directory that holds a `node_modules`, or null. */
export async function ancestorNodeModules(directory) {
  let current = path.resolve(directory);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    if (await isDirectory(path.join(parent, 'node_modules'))) return path.join(parent, 'node_modules');
    current = parent;
  }
}

/** Fails when `directory` could fall back on a dependency tree above it. */
export async function assertOutOfTree(directory, label) {
  const shadow = await ancestorNodeModules(directory);
  if (shadow) {
    throw new Error(
      `${label} at ${directory} sits below ${shadow}; module resolution would fall back on it, `
      + 'so a smoke run there cannot prove the artifact is complete.',
    );
  }
}

/**
 * Copies `sourceDir` to a fresh temp directory outside any `node_modules`
 * ancestor, runs `work(copyDir)`, and removes the copy afterwards.
 *
 * `filter(sourcePath)` may return false to leave a subtree out of the copy.
 */
export async function withOutOfTreeCopy(sourceDir, label, work, { filter } = {}) {
  const copyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-out-of-tree-'));
  try {
    await assertOutOfTree(copyDir, `${label} copy`);
    await fs.cp(sourceDir, copyDir, {
      recursive: true,
      // Keep symlinks as symlinks and keep their targets verbatim: without
      // `verbatimSymlinks`, fs.cp rewrites a relative `.bin` shim into an
      // absolute path back into the source tree, which is the very fallback
      // this copy exists to remove.
      dereference: false,
      verbatimSymlinks: true,
      filter: filter ? (source) => filter(source) : undefined,
    });
    return await work(copyDir);
  } finally {
    await fs.rm(copyDir, { recursive: true, force: true });
  }
}
