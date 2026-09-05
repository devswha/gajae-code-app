import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateWindowsIcon, pngsToIco, sourceIcons } from './generate-windows-icon.mjs';

const iconDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'icons');

test('ICO directory describes three complete, byte-identical PNGs including the 256-pixel sentinel', async () => {
  const pngs = await Promise.all(sourceIcons.map((name) => readFile(join(iconDirectory, name))));
  const ico = pngsToIco(pngs);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  let end = 6 + 3 * 16;
  for (let index = 0; index < 3; index += 1) {
    const entry = 6 + index * 16;
    const dimension = [32, 128, 256][index];
    assert.equal(ico[entry] || 256, dimension);
    assert.equal(ico[entry + 1] || 256, dimension);
    assert.equal(ico[entry + 2], 0);
    assert.equal(ico[entry + 3], 0);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(offset, end);
    assert.equal(length, pngs[index].length);
    assert.deepEqual(ico.subarray(offset, offset + length), pngs[index]);
    end += length;
  }
  assert.equal(end, ico.length);
  assert.deepEqual(pngsToIco(pngs), ico);
  assert.deepEqual(await readFile(join(iconDirectory, 'icon.ico')), ico);
  await generateWindowsIcon();
});

test('ICO conversion rejects unsupported source formats and sizes', async () => {
  const png = await readFile(join(iconDirectory, '32x32.png'));
  assert.throws(() => pngsToIco([]), /requires/);
  assert.throws(() => pngsToIco([Buffer.alloc(33)]), /PNG/);
  assert.throws(() => pngsToIco([png.subarray(0, 32)]), /PNG/);
  assert.throws(() => pngsToIco([png, png]), /Duplicate/);
  const nonsquare = Buffer.from(png);
  nonsquare.writeUInt32BE(31, 20);
  assert.throws(() => pngsToIco([nonsquare]), /square/);
  const oversized = await readFile(join(iconDirectory, '512x512.png'));
  assert.throws(() => pngsToIco([oversized]), /256/);
  const rgb = Buffer.from(png);
  rgb[25] = 2;
  assert.throws(() => pngsToIco([rgb]), /RGBA/);
});

test('check detects missing/stale assets and regeneration is deterministic without altering source PNGs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae ico tests '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of sourceIcons) await copyFile(join(iconDirectory, name), join(directory, name));
  await assert.rejects(generateWindowsIcon({ directory }), /missing or stale/);
  await generateWindowsIcon({ directory, write: true });
  const first = await readFile(join(directory, 'icon.ico'));
  await generateWindowsIcon({ directory, write: true });
  assert.deepEqual(await readFile(join(directory, 'icon.ico')), first);
  await generateWindowsIcon({ directory });
  await writeFile(join(directory, 'icon.ico'), first.subarray(0, first.length - 1));
  await assert.rejects(generateWindowsIcon({ directory }), /missing or stale/);
  for (const name of sourceIcons) {
    assert.deepEqual(await readFile(join(directory, name)), await readFile(join(iconDirectory, name)));
  }
});
