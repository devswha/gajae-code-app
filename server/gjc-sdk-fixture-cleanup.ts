import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { closeModelCache } from '@gajae-code/ai/model-cache';

/** Call only after every fixture session, registry, auth store and Settings owner has closed. */
export async function removeSdkFixture(root: string): Promise<void> {
  // The model cache is process-scoped, not owned by ModelRegistry.dispose().
  // Never close another fixture's active cache when roots overlap in time.
  const modelCacheClosed = closeModelCache(join(root, 'agent', 'models.db'));
  if (process.platform === 'win32') {
    const bun = (globalThis as typeof globalThis & { Bun?: { gc(force?: boolean): void } }).Bun;
    if (!bun) throw new Error('Windows SDK fixtures require Bun.gc(true).');
    // Bun 1.4.0 defers close(false) until uncached SQLite statements finalize.
    // Collect from a fresh task after all supported owner closes, not from a
    // deep disposal stack. This is finalization, never a filesystem retry.
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try { bun.gc(true); resolve(); }
        catch (error) { reject(error); }
      }, 0);
    });
  }
  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    const remaining = await readdir(root, { recursive: true })
      .catch((listingError: unknown) => [`Cannot list retained files: ${String(listingError)}`]);
    throw new Error(`SDK fixture cleanup failed: ${JSON.stringify({
      modelCacheClosed, cwd: process.cwd(), remaining: remaining.slice(0, 50), remainingCount: remaining.length,
    })}`, { cause: error });
  }
}
