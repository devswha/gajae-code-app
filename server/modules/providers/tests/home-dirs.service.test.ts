import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  filterDirSuggestions,
  getHomeDirSuggestions,
  splitPrefix,
} from '@/modules/providers/services/home-dirs.service.js';

test('splitPrefix separates listed dir from typed fragment', () => {
  assert.deepEqual(splitPrefix('workspace/ma'), { dirPart: 'workspace', fragment: 'ma' });
  assert.deepEqual(splitPrefix('work'), { dirPart: '', fragment: 'work' });
  assert.deepEqual(splitPrefix('workspace/'), { dirPart: 'workspace', fragment: '' });
});

test('filterDirSuggestions matches fragment, hides dotdirs, sorts, prefixes dirPart', () => {
  const out = filterDirSuggestions({
    dirPart: 'workspace',
    fragment: 'ma',
    entryNames: ['magi-stock', 'patina', 'mars', '.magic'],
  });
  assert.deepEqual(out, ['workspace/magi-stock', 'workspace/mars']);
});

test('filterDirSuggestions shows hidden dirs only when the fragment is dotted', () => {
  const out = filterDirSuggestions({ dirPart: '', fragment: '.c', entryNames: ['.config', '.cache', 'code'] });
  assert.deepEqual(out, ['.cache', '.config']);
});

test('getHomeDirSuggestions rejects traversal and absolute prefixes', async () => {
  assert.deepEqual(await getHomeDirSuggestions('../etc/'), []);
  assert.deepEqual(await getHomeDirSuggestions('/etc/'), []);
  assert.deepEqual(await getHomeDirSuggestions('a/../../etc/'), []);
});

test('getHomeDirSuggestions: realpath containment — deep symlink escape returns [], decoy-style direct-child symlink works', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'home-dirs-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'outside-'));
  try {
    await mkdir(path.join(outside, 'secret-dir'));
    await mkdir(path.join(home, 'workspace'));
    await mkdir(path.join(home, 'workspace', 'proj'));
    // Deep symlink escaping HOME (attacker-planted shape).
    await symlink(outside, path.join(home, 'workspace', 'evil'));
    // Decoy-HOME shape: a DIRECT child of home symlinked elsewhere must work.
    await mkdir(path.join(outside, 'real-workspace'));
    await mkdir(path.join(outside, 'real-workspace', 'app'));
    await symlink(path.join(outside, 'real-workspace'), path.join(home, 'linked'));

    // Normal listing under home.
    assert.deepEqual(await getHomeDirSuggestions('workspace/p', home), ['workspace/proj']);
    // Listing THROUGH the deep escape symlink is refused.
    assert.deepEqual(await getHomeDirSuggestions('workspace/evil/', home), []);
    // Direct-child symlink (decoy pattern) still browsable.
    assert.deepEqual(await getHomeDirSuggestions('linked/a', home), ['linked/app']);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
