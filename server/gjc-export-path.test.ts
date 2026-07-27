import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { defaultExportFileName, resolveContainedExportCommand } from './gjc-export-path.js';

/*
 * `/export` containment.
 *
 * The defect these guard: upstream resolves the export output path relatively,
 * so it lands in the worker's process cwd. That worker is a single child shared
 * by every session for the API server's lifetime, so the destination has to be
 * derived per run from the run's own project directory — never from anything
 * fixed at spawn time.
 */

const SESSION_FILE = '/sessions/root/0199aa11-2233.jsonl';
const PROJECT = path.resolve('/tmp/gjc-project');

test('bare /export resolves under the run project directory', () => {
  const resolution = resolveContainedExportCommand('/export', PROJECT, SESSION_FILE);
  assert.equal(resolution.kind, 'contained');
  assert.equal(
    resolution.kind === 'contained' ? resolution.outputPath : '',
    path.join(PROJECT, 'gjc-session-0199aa11-2233.html'),
  );
  assert.equal(
    resolution.kind === 'contained' ? resolution.message : '',
    `/export ${path.join(PROJECT, 'gjc-session-0199aa11-2233.html')}`,
  );
});

test('bare /export keeps the upstream default filename shape', () => {
  assert.equal(defaultExportFileName(SESSION_FILE), 'gjc-session-0199aa11-2233.html');
  assert.equal(defaultExportFileName('/a/b/plain.jsonl'), 'gjc-session-plain.html');
});

test('identical input resolves to a different path for each run cwd', () => {
  // The property a spawn-time cwd cannot provide: two runs, one process.
  const one = resolveContainedExportCommand('/export', path.resolve('/tmp/p-one'), SESSION_FILE);
  const two = resolveContainedExportCommand('/export', path.resolve('/tmp/p-two'), SESSION_FILE);
  assert.equal(one.kind, 'contained');
  assert.equal(two.kind, 'contained');
  assert.equal(
    one.kind === 'contained' ? one.outputPath : '',
    path.join(path.resolve('/tmp/p-one'), 'gjc-session-0199aa11-2233.html'),
  );
  assert.equal(
    two.kind === 'contained' ? two.outputPath : '',
    path.join(path.resolve('/tmp/p-two'), 'gjc-session-0199aa11-2233.html'),
  );
});

test('a relative output path resolves under the project, not the process cwd', () => {
  const resolution = resolveContainedExportCommand('/export out.html', PROJECT, SESSION_FILE);
  assert.equal(resolution.kind, 'contained');
  assert.equal(
    resolution.kind === 'contained' ? resolution.outputPath : '',
    path.join(PROJECT, 'out.html'),
  );
});

test('a nested relative output path stays under the project', () => {
  const resolution = resolveContainedExportCommand('/export docs/session.html', PROJECT, SESSION_FILE);
  assert.equal(
    resolution.kind === 'contained' ? resolution.outputPath : '',
    path.join(PROJECT, 'docs', 'session.html'),
  );
});

test('a relative path containing spaces survives the rewrite', () => {
  const resolution = resolveContainedExportCommand('/export my notes.html', PROJECT, SESSION_FILE);
  assert.equal(
    resolution.kind === 'contained' ? resolution.outputPath : '',
    path.join(PROJECT, 'my notes.html'),
  );
  assert.equal(
    resolution.kind === 'contained' ? resolution.message : '',
    `/export ${path.join(PROJECT, 'my notes.html')}`,
  );
});

test('a relative path that climbs out of the project is rejected', () => {
  for (const escape of ['../escape.html', '../../escape.html', 'docs/../../escape.html']) {
    const resolution = resolveContainedExportCommand(`/export ${escape}`, PROJECT, SESSION_FILE);
    assert.equal(resolution.kind, 'rejected', `expected ${escape} to be rejected`);
  }
});

test('an absolute output path is deliberate and passes through', () => {
  const resolution = resolveContainedExportCommand('/export /tmp/elsewhere.html', PROJECT, SESSION_FILE);
  assert.equal(resolution.kind, 'passthrough');
});

test('clipboard aliases pass through to the upstream usage message', () => {
  for (const alias of ['--copy', 'clipboard', 'copy']) {
    const resolution = resolveContainedExportCommand(`/export ${alias}`, PROJECT, SESSION_FILE);
    assert.equal(resolution.kind, 'passthrough', `expected ${alias} to pass through`);
  }
});

test('a run without a usable project directory refuses instead of writing', () => {
  for (const cwd of ['', 'relative/path']) {
    const resolution = resolveContainedExportCommand('/export', cwd, SESSION_FILE);
    assert.equal(resolution.kind, 'rejected');
  }
});

test('an in-memory session passes through so upstream raises its own error', () => {
  assert.equal(resolveContainedExportCommand('/export', PROJECT, null).kind, 'passthrough');
  assert.equal(resolveContainedExportCommand('/export', PROJECT, undefined).kind, 'passthrough');
});

test('non-export commands are untouched', () => {
  for (const message of ['/dump', '/exportsomething', 'export', '/jobs', 'please /export this']) {
    assert.equal(
      resolveContainedExportCommand(message, PROJECT, SESSION_FILE).kind,
      'passthrough',
      `expected ${message} to pass through`,
    );
  }
});
