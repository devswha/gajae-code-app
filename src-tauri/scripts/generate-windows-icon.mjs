#!/usr/bin/env node
// Losslessly pack the existing RGBA PNGs into a Windows ICO. PNG-backed ICO
// entries are supported by the Windows versions supported by Tauri and NSIS.
// No resampling, metadata, timestamps, external tools, or new dependencies.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'icons');
export const sourceIcons = ['32x32.png', '128x128.png', '128x128@2x.png'];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngsToIco(pngs) {
  if (pngs.length === 0 || pngs.length > 65535) throw new Error('ICO requires between 1 and 65535 PNG images');
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  const sizes = new Set();
  for (const [index, png] of pngs.entries()) {
    if (png.length < 33 || !png.subarray(0, 8).equals(pngSignature)
      || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('ICO input must be a PNG with an IHDR chunk');
    }
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width !== height || width < 1 || width > 256) throw new Error('ICO PNGs must be square and at most 256 pixels');
    if (png[24] !== 8 || png[25] !== 6) throw new Error('ICO PNGs must use 8-bit RGBA');
    if (sizes.has(width)) throw new Error(`Duplicate ICO size: ${width}`);
    sizes.add(width);
    const entry = 6 + index * 16;
    header[entry] = width === 256 ? 0 : width;
    header[entry + 1] = height === 256 ? 0 : height;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }
  return Buffer.concat([header, ...pngs]);
}

export async function generateWindowsIcon({ directory = iconDirectory, write = false } = {}) {
  const pngs = await Promise.all(sourceIcons.map((name) => readFile(join(directory, name))));
  const ico = pngsToIco(pngs);
  const destination = join(directory, 'icon.ico');
  if (write) {
    await writeFile(destination, ico);
  } else {
    const existing = await readFile(destination).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!existing?.equals(ico)) {
      throw new Error('Windows icon is missing or stale. Run node src-tauri/scripts/generate-windows-icon.mjs --write');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--write', '--check'].includes(args[0]))) {
    throw new Error('Usage: generate-windows-icon.mjs [--write | --check]');
  }
  await generateWindowsIcon({ write: args[0] === '--write' });
}
