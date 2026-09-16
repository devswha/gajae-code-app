import assert from 'node:assert/strict';
import test from 'node:test';

import { egoActivityToken, type EgoActivitySnapshot } from '@/gjc-engine.js';

import { EgoActivityReader, EgoActivityStore } from './ego-activity.js';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

function reader(options: {
  configured?: boolean;
  backend?: 'builtin' | 'aside' | 'ego';
  platform?: NodeJS.Platform;
  probe?: () => { ok: true; path: string } | { ok: false; searched: string[] };
  snapshot?: EgoActivitySnapshot;
  now?: () => number;
} = {}) {
  const reads: string[] = [];
  const instance = new EgoActivityReader({
    store: { get: () => options.configured ?? true },
    backend: { get: () => options.backend ?? 'ego' },
    platform: options.platform ?? 'darwin',
    probe: options.probe ?? (() => ({ ok: true, path: '/Users/me/.local/bin/ego-browser' })),
    read: async ({ cliPath }) => {
      reads.push(cliPath);
      return options.snapshot ?? { spaces: [] };
    },
    ...(options.now ? { now: options.now } : {}),
  });
  return { instance, reads };
}

test('the opt-in is off by default, stores one key and refuses anything but a boolean', () => {
  const storage = memoryStorage();
  const store = new EgoActivityStore(storage);
  assert.equal(store.get(), false);
  assert.equal(store.set(true), true);
  assert.equal(store.get(), true);
  assert.deepEqual([...storage.values.keys()], ['automation.egoActivity.v1']);
  assert.equal(store.set(false), false);
  assert.equal(store.get(), false);
  for (const rejected of ['true', '1', 1, 0, null, undefined, {}]) {
    assert.throws(() => store.set(rejected), /must be true or false/u, JSON.stringify(rejected));
  }
  // An unknown stored value is off, never on.
  assert.equal(new EgoActivityStore(memoryStorage({ 'automation.egoActivity.v1': 'yes' })).get(), false);
});

test('nothing executes unless the surface is opted in, supported and the run uses ego', async () => {
  for (const off of [
    { configured: false },
    { backend: 'builtin' as const },
    { backend: 'aside' as const },
    { platform: 'linux' as NodeJS.Platform },
  ]) {
    const { instance, reads } = reader(off);
    const result = await instance.snapshot('session-a');
    assert.equal(result.enabled, false, JSON.stringify(off));
    assert.deepEqual(result.spaces, []);
    assert.deepEqual(reads, [], 'a disabled surface never executes the CLI');
  }

  // Settings reads the opt-in itself without a session, and still runs nothing.
  const { instance, reads } = reader({ configured: true });
  const config = await instance.snapshot();
  assert.equal(config.configured, true);
  assert.equal(config.enabled, true);
  assert.deepEqual(config.spaces, []);
  assert.deepEqual(reads, []);
});

test('a missing CLI reports unavailable without executing anything', async () => {
  const { instance, reads } = reader({ probe: () => ({ ok: false, searched: ['/Users/me/.local/bin/ego-browser'] }) });
  const result = await instance.snapshot('session-a');
  assert.equal(result.enabled, true);
  assert.equal(result.unavailable, true);
  assert.deepEqual(result.spaces, []);
  assert.deepEqual(reads, []);
});

test('only the spaces this session minted are returned, and the token never leaves the server', async () => {
  const mine = egoActivityToken('session-a');
  const theirs = egoActivityToken('session-b');
  const { instance } = reader({
    snapshot: {
      spaces: [
        { id: 3, token: mine, name: 'check the dashboard', pages: [{ label: 'p1', url: 'https://example.com', title: 'Example', active: true }] },
        { id: 4, token: theirs, name: 'other session work', pages: [] },
      ],
    },
  });

  const result = await instance.snapshot('session-a');
  assert.deepEqual(result.spaces.map((space) => space.id), [3]);
  assert.equal(result.spaces[0].name, 'check the dashboard');
  assert.equal('token' in result.spaces[0], false);
  assert.deepEqual((await instance.snapshot('session-c')).spaces, []);
});

test('concurrent sessions share one execution, and the cache expires', async () => {
  let clock = 1_000;
  const { instance, reads } = reader({ now: () => clock });

  await Promise.all([instance.snapshot('session-a'), instance.snapshot('session-b')]);
  assert.equal(reads.length, 1, 'a poll from two sessions is one CLI process');

  clock += 500;
  await instance.snapshot('session-a');
  assert.equal(reads.length, 1, 'a repeat inside the window reuses the snapshot');

  clock += 1_500;
  await instance.snapshot('session-a');
  assert.equal(reads.length, 2, 'the snapshot is never served stale beyond its window');
});
