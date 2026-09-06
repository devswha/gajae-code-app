import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';

import { withFileLock } from '@gajae-code/coding-agent/config/file-lock';
import { exactRemoveDirectoryTree, nativeBuildInfo, snapshotDirectoryTree } from '@gajae-code/natives';

// Run in a separate Bun process: no AgentSession, database, or broker owns these
// paths. A refusal stays fatal; neither retry it nor change the SDK's budgets.
console.log(JSON.stringify({
  probe: 'sdk-file-locks',
  platform: process.platform,
  release: release(),
  bun: process.versions.bun,
  native: nativeBuildInfo(),
  image: process.env.ImageOS ?? null,
}));

const scratch = join(process.cwd(), '.tmp');
await mkdir(scratch, { recursive: true });
const bases = new Set([await realpath(tmpdir()), await realpath(scratch)]);
const failures = [];

for (const base of bases) {
  const filesystem = await statfs(base);
  console.log(JSON.stringify({ base, filesystem: { type: filesystem.type, bsize: filesystem.bsize } }));
  for (const operation of ['native-exact-remove', 'sdk-release', 'sdk-contended-release']) {
    const root = await realpath(await mkdtemp(join(base, 'gjc-native-lock-probe-')));
    console.log(JSON.stringify({ operation, root, phase: 'start' }));
    try {
      const file = join(root, 'config.yml');
      const lock = `${file}.lock`;
      if (operation === 'native-exact-remove') {
        await mkdir(lock);
        await writeFile(join(lock, 'info'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
        const captured = snapshotDirectoryTree(lock);
        console.log(JSON.stringify({ operation, root, capture: { ok: captured.ok, code: captured.code } }));
        assert.ok(captured.ok && captured.snapshot, 'Native lock snapshot must succeed.');
        const removed = exactRemoveDirectoryTree(lock, captured.snapshot);
        // Preserve NTSTATUS and retained/quarantine paths discarded by the
        // SDK's higher-level EACCES exception. Do not mutate returned paths.
        console.log(JSON.stringify({ operation, root, removed }));
        assert.equal(removed.ok, true, 'Native lock removal must succeed without another owner.');
      } else {
        let active = 0;
        const values = operation === 'sdk-release' ? ['first'] : ['first', 'second'];
        const outcomes = await Promise.allSettled(values.map(value => withFileLock(file, async () => {
          active += 1;
          try {
            assert.equal(active, 1, 'File-lock callbacks must be exclusive.');
            const staging = `${file}.tmp`;
            await writeFile(staging, value);
            await rename(staging, file);
            return value;
          } finally {
            active -= 1;
          }
        })));
        const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
        if (errors.length) throw new AggregateError(errors, 'Public SDK file-lock transaction failed.');
        assert.deepEqual(outcomes.map(outcome => outcome.value), values);
        assert.ok(values.includes(await readFile(file, 'utf8')), 'The committed payload must remain readable.');
      }
      await assert.rejects(lstat(lock), { code: 'ENOENT' });
      console.log(JSON.stringify({ operation, root, phase: 'passed' }));
    } catch (error) {
      failures.push(error);
      console.error(JSON.stringify({ operation, root, phase: 'failed' }));
      console.error(error);
    } finally {
      // All lock callers settled above. One removal attempt only; preserve
      // cleanup errors independently instead of replacing the original refusal.
      try {
        await rm(root, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
        console.error(JSON.stringify({ operation, retainedRoot: root, phase: 'cleanup-failed' }));
        console.error(error);
      }
    }
  }
}

if (failures.length) throw new AggregateError(failures, 'Pinned SDK filesystem conformance failed.');
