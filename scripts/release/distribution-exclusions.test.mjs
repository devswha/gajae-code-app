import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  EXCLUDED_FROM_DISTRIBUTION,
  describeDistributionExclusions,
  removeExcludedDistributionPackages,
} from './distribution-exclusions.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..');

async function fakeTree(packages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-exclusions-'));
  const nodeModules = path.join(root, 'node_modules');
  for (const [name, version] of Object.entries(packages)) {
    const dir = path.join(nodeModules, ...name.split('/'));
    await fs.mkdir(path.join(dir, 'lib'), { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version, license: 'EPL-2.0' }));
    await fs.writeFile(path.join(dir, 'lib', 'real.js'), 'throw new Error("real package code must not ship")\n');
  }
  return { root, nodeModules };
}

test('every exclusion with a stub points at a first-party MIT package of the same name', async () => {
  for (const entry of EXCLUDED_FROM_DISTRIBUTION) {
    if (!entry.stub) continue;
    const manifest = JSON.parse(
      await fs.readFile(path.join(REPOSITORY_ROOT, 'scripts', 'release', 'stubs', entry.stub, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.name, entry.package);
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.gajae?.stub, true);
  }
});

test('removing the excluded packages installs the stub with the replaced version', async () => {
  const versions = Object.fromEntries(EXCLUDED_FROM_DISTRIBUTION.map((entry, index) => [entry.package, `9.${index}.0`]));
  const { root, nodeModules } = await fakeTree(versions);
  try {
    const result = await removeExcludedDistributionPackages(fs, path, nodeModules);
    assert.deepEqual(result.removed, EXCLUDED_FROM_DISTRIBUTION.map((entry) => entry.package));
    assert.deepEqual(result.stubbed, EXCLUDED_FROM_DISTRIBUTION.filter((entry) => entry.stub).map((entry) => entry.package));
    assert.match(describeDistributionExclusions(result), /^Excluded mupdf, elkjs; stubbed elkjs/);

    for (const entry of EXCLUDED_FROM_DISTRIBUTION) {
      const dir = path.join(nodeModules, ...entry.package.split('/'));
      if (!entry.stub) {
        await assert.rejects(fs.access(dir), 'a plain exclusion leaves nothing behind');
        continue;
      }
      await assert.rejects(fs.access(path.join(dir, 'lib', 'real.js')), 'no file of the real package survives');
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
      assert.equal(manifest.name, entry.package);
      assert.equal(manifest.version, versions[entry.package]);
      assert.equal(manifest.license, 'MIT');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the elkjs stub satisfies the import surface beautiful-mermaid touches and fails only on layout', async () => {
  const { root, nodeModules } = await fakeTree({ elkjs: '0.11.1' });
  try {
    await removeExcludedDistributionPackages(fs, path, nodeModules);
    // The exact specifier from beautiful-mermaid/src/elk-instance.ts.
    const bundled = pathToFileURL(path.join(nodeModules, 'elkjs', 'lib', 'elk.bundled.js')).href;
    const { default: ELKBundled } = await import(bundled);
    const { default: fromMain } = await import(pathToFileURL(path.join(nodeModules, 'elkjs', 'lib', 'main.js')).href);
    assert.equal(fromMain, ELKBundled);

    // Construction is what ensureElk() does; it must not throw.
    const elk = new ELKBundled();
    const rawWorker = elk.worker.worker;
    assert.equal(typeof rawWorker.postMessage, 'function');
    assert.equal(typeof rawWorker.dispatcher.saveDispatch, 'function');

    // elkLayoutSync(): replace onmessage, saveDispatch synchronously, read the answer.
    let answer;
    rawWorker.onmessage = (message) => { answer = message; };
    rawWorker.dispatcher.saveDispatch({ data: { id: 0, cmd: 'layout', graph: { id: 'root' } } });
    assert.ok(answer, 'the stub answers synchronously, as the FakeWorker bypass requires');
    assert.equal(answer.data.id, 0);
    assert.match(answer.data.error.message, /ELK layout is not bundled in this distribution/);
    assert.equal(answer.data.error.code, 'ELK_NOT_BUNDLED');

    // The public API rejects with the same error instead of hanging.
    await assert.rejects(elk.layout({ id: 'root', children: [] }), /ELK layout is not bundled/);
    assert.deepEqual(await elk.knownLayoutAlgorithms(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a non-ASCII bin link is dropped and any other non-ASCII path refuses to ship', async () => {
  const { removeNonAsciiPaths } = await import(pathToFileURL(path.join(process.cwd(), 'scripts/release/distribution-exclusions.mjs')).href);
  const payload = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-payload-ascii-'));
  try {
    await fs.mkdir(path.join(payload, 'node_modules/.bin'), { recursive: true });
    await fs.mkdir(path.join(payload, 'node_modules/@gajae-code/coding-agent/bin'), { recursive: true });
    await fs.writeFile(path.join(payload, 'node_modules/@gajae-code/coding-agent/bin/gajaessi.js'), '#!/usr/bin/env node\n');
    await fs.symlink('../@gajae-code/coding-agent/bin/gajaessi.js', path.join(payload, 'node_modules/.bin/가재씨'));
    await fs.symlink('../@gajae-code/coding-agent/bin/gajaessi.js', path.join(payload, 'node_modules/.bin/gjc'));

    assert.deepEqual(await removeNonAsciiPaths(fs, path, payload), ['node_modules/.bin/가재씨']);
    assert.deepEqual((await fs.readdir(path.join(payload, 'node_modules/.bin'))).sort(), ['gjc']);
    // Idempotent once clean.
    assert.deepEqual(await removeNonAsciiPaths(fs, path, payload), []);

    await fs.writeFile(path.join(payload, 'node_modules/@gajae-code/coding-agent/bin/설명.md'), 'x');
    await assert.rejects(removeNonAsciiPaths(fs, path, payload), /설명\.md/);
  } finally {
    await fs.rm(payload, { recursive: true, force: true });
  }
});
