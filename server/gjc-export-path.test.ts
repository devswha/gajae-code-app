import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { defaultExportFileName, resolveExportCommand } from './gjc-export-path.js';

/*
 * `/export` resolution.
 *
 * The defect these guard: upstream resolves the export output path relatively,
 * so it lands in the worker's process cwd. That worker is a single child shared
 * by every session for the API server's lifetime, so the destination has to be
 * derived per run from the run's own project directory — never from anything
 * fixed at spawn time. Past that, a path lands where it would in the CLI.
 */

const SESSION_FILE = '/sessions/root/0199aa11-2233.jsonl';
const PROJECT = path.resolve('/tmp/gjc-project');

test('bare /export resolves under the run project directory', () => {
  const resolution = resolveExportCommand('/export', PROJECT, SESSION_FILE);
  assert.equal(resolution.kind, 'resolved');
  assert.equal(
    resolution.kind === 'resolved' ? resolution.outputPath : '',
    path.join(PROJECT, 'gjc-session-0199aa11-2233.html'),
  );
  assert.equal(
    resolution.kind === 'resolved' ? resolution.message : '',
    `/export ${path.join(PROJECT, 'gjc-session-0199aa11-2233.html')}`,
  );
});

test('bare /export keeps the upstream default filename shape', () => {
  assert.equal(defaultExportFileName(SESSION_FILE), 'gjc-session-0199aa11-2233.html');
  assert.equal(defaultExportFileName('/a/b/plain.jsonl'), 'gjc-session-plain.html');
});

test('identical input resolves to a different path for each run cwd', () => {
  // The property a spawn-time cwd cannot provide: two runs, one process.
  const one = resolveExportCommand('/export', path.resolve('/tmp/p-one'), SESSION_FILE);
  const two = resolveExportCommand('/export', path.resolve('/tmp/p-two'), SESSION_FILE);
  assert.equal(one.kind, 'resolved');
  assert.equal(two.kind, 'resolved');
  assert.equal(
    one.kind === 'resolved' ? one.outputPath : '',
    path.join(path.resolve('/tmp/p-one'), 'gjc-session-0199aa11-2233.html'),
  );
  assert.equal(
    two.kind === 'resolved' ? two.outputPath : '',
    path.join(path.resolve('/tmp/p-two'), 'gjc-session-0199aa11-2233.html'),
  );
});

test('a relative output path resolves under the project, not the process cwd', () => {
  const resolution = resolveExportCommand('/export out.html', PROJECT, SESSION_FILE);
  assert.equal(resolution.kind, 'resolved');
  assert.equal(
    resolution.kind === 'resolved' ? resolution.outputPath : '',
    path.join(PROJECT, 'out.html'),
  );
});

test('a nested relative output path resolves under the project', () => {
  const resolution = resolveExportCommand('/export docs/session.html', PROJECT, SESSION_FILE);
  assert.equal(
    resolution.kind === 'resolved' ? resolution.outputPath : '',
    path.join(PROJECT, 'docs', 'session.html'),
  );
});

test('a relative path containing spaces survives the rewrite', () => {
  const resolution = resolveExportCommand('/export my notes.html', PROJECT, SESSION_FILE);
  assert.equal(
    resolution.kind === 'resolved' ? resolution.outputPath : '',
    path.join(PROJECT, 'my notes.html'),
  );
  assert.equal(
    resolution.kind === 'resolved' ? resolution.message : '',
    `/export ${path.join(PROJECT, 'my notes.html')}`,
  );
});

test('a relative path that climbs out of the project lands where the CLI would write it', () => {
  for (const relative of ['../outside.html', '../../outside.html', 'docs/../../outside.html']) {
    const resolution = resolveExportCommand(`/export ${relative}`, PROJECT, SESSION_FILE);
    assert.equal(resolution.kind, 'resolved', relative);
    assert.equal(resolution.kind === 'resolved' ? resolution.outputPath : '', path.resolve(PROJECT, relative), relative);
  }
});

test('an absolute output path is deliberate and passes through', () => {
  const resolution = resolveExportCommand('/export /tmp/elsewhere.html', PROJECT, SESSION_FILE);
  assert.equal(resolution.kind, 'passthrough');
});

test('clipboard aliases pass through to the upstream usage message', () => {
  for (const alias of ['--copy', 'clipboard', 'copy']) {
    const resolution = resolveExportCommand(`/export ${alias}`, PROJECT, SESSION_FILE);
    assert.equal(resolution.kind, 'passthrough', `expected ${alias} to pass through`);
  }
});

test('a run without a usable project directory refuses instead of writing', () => {
  for (const cwd of ['', 'relative/path']) {
    const resolution = resolveExportCommand('/export', cwd, SESSION_FILE);
    assert.equal(resolution.kind, 'rejected');
  }
});

test('an in-memory session passes through so upstream raises its own error', () => {
  assert.equal(resolveExportCommand('/export', PROJECT, null).kind, 'passthrough');
  assert.equal(resolveExportCommand('/export', PROJECT, undefined).kind, 'passthrough');
});

test('non-export commands are untouched', () => {
  for (const message of ['/dump', '/exportsomething', 'export', '/jobs', 'please /export this']) {
    assert.equal(
      resolveExportCommand(message, PROJECT, SESSION_FILE).kind,
      'passthrough',
      `expected ${message} to pass through`,
    );
  }
});
