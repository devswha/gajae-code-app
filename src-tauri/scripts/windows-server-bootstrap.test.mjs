import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const bootstrap = await readFile(new URL('../src/windows-server-bootstrap.cjs', import.meta.url), 'utf8');

test('Windows bootstrap imports a Unicode path and delivers one graceful shutdown through stdin', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae desktop 한글 '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entrypoint = join(directory, 'server with spaces.mjs');
  await writeFile(entrypoint, `
    let requests = 0;
    process.on('SIGTERM', () => {
      requests += 1;
      setTimeout(() => { console.log('stopped:' + requests); process.exit(0); }, 50);
    });
    console.log('ready:' + process.argv[1]);
    setInterval(() => {}, 1000);
  `);
  const child = spawn(process.execPath, ['--eval', bootstrap, entrypoint], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  t.after(() => clearTimeout(timer));
  const completed = once(child, 'close');
  let output = '';
  let errors = '';
  let sent = false;
  child.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk;
    if (!sent && output.includes('ready:')) {
      sent = true;
      child.stdin.write('ignored\ngajae-desktop-shut');
      child.stdin.write('down\ngajae-desktop-shutdown\n');
    }
  });
  const [code, signal] = await completed;
  assert.equal(code, 0, errors);
  assert.equal(signal, null);
  assert.ok(output.includes(`ready:${entrypoint}`), output);
  assert.ok(output.includes('stopped:1'), output);
  assert.equal(errors, '');
});

test('Windows bootstrap reports an import failure without leaving its stdin listener alive', async () => {
  const child = spawn(process.execPath, ['--eval', bootstrap, join(tmpdir(), 'missing-gajae-entrypoint.mjs')]);
  child.stderr.resume();
  child.stdout.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [code, signal] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(signal, null);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
