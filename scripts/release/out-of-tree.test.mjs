import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ancestorNodeModules, assertOutOfTree, withOutOfTreeCopy } from './out-of-tree.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('an artifact inside this checkout is shadowed by the repository node_modules', async () => {
  const inTree = path.join(REPOSITORY_ROOT, 'src-tauri', 'resources', 'server-payload');
  assert.equal(await ancestorNodeModules(inTree), path.join(REPOSITORY_ROOT, 'node_modules'));
  await assert.rejects(assertOutOfTree(inTree, 'payload'), /module resolution would fall back on it/);
});

test('a copy lands outside any node_modules ancestor and is removed afterwards', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-out-of-tree-source-'));
  try {
    await fs.mkdir(path.join(source, 'keep', 'nested'), { recursive: true });
    await fs.mkdir(path.join(source, 'skip'), { recursive: true });
    await fs.writeFile(path.join(source, 'keep', 'nested', 'file.txt'), 'kept');
    await fs.writeFile(path.join(source, 'skip', 'file.txt'), 'skipped');
    await fs.symlink('keep/nested/file.txt', path.join(source, 'link'));

    let seen;
    await withOutOfTreeCopy(source, 'fixture', async (copyDir) => {
      seen = copyDir;
      assert.equal(await ancestorNodeModules(copyDir), null);
      assert.equal(await fs.readFile(path.join(copyDir, 'keep', 'nested', 'file.txt'), 'utf8'), 'kept');
      await assert.rejects(fs.access(path.join(copyDir, 'skip')), 'filtered subtrees are not copied');
      assert.equal(await fs.readlink(path.join(copyDir, 'link')), 'keep/nested/file.txt');
    }, { filter: (entry) => entry !== path.join(source, 'skip') });
    await assert.rejects(fs.access(seen), 'the copy is removed once the work is done');
  } finally {
    await fs.rm(source, { recursive: true, force: true });
  }
});
