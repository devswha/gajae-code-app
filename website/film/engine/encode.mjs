#!/usr/bin/env node
// Web encodes from a lossless RGB master.
//
// Colour: the master is full-range sRGB (what Chromium paints). It is converted
// to limited-range Y'CbCr with the BT.709 matrix and the stream is tagged
// bt709 primaries / transfer / matrix, so browsers decode it back with the same
// matrix and the orange/green accents do not shift.
//
//   node engine/encode.mjs h264 master.mkv out.mp4 [--budget 5MB] [--crf 18]
//   node engine/encode.mjs av1  master.mkv out.webm [--budget 4MB] [--crf 30]
//   node engine/encode.mjs poster master.mkv out.webp [out.jpg ...]
//
// With a budget, the CRF starts at a high-quality value and is raised one step
// at a time until the file fits, so the UI text stays as sharp as the budget allows.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const colorFilter = (pixFmt = 'yuv420p') =>
  `scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int+full_chroma_inp,format=${pixFmt}`;
const COLOR_FILTER = colorFilter();
const COLOR_TAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.stderr.on('data', (d) => {
      err += d;
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`))));
  });
}

export function parseSize(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = /^([\d.]+)\s*(KB|MB|B)?$/i.exec(String(v).trim());
  if (!m) throw new Error(`bad size ${v}`);
  const mult = { B: 1, KB: 1000, MB: 1000 * 1000 }[(m[2] ?? 'B').toUpperCase()];
  return Math.round(Number(m[1]) * mult);
}

async function fit({ encodeAt, out, budget, crf, maxCrf, step }) {
  const tries = [];
  for (let c = crf; c <= maxCrf; c += step) {
    await encodeAt(c);
    const size = fs.statSync(out).size;
    tries.push({ crf: c, size });
    if (!budget || size <= budget) return { out, crf: c, size, tries };
  }
  throw new Error(`${out}: does not fit ${budget} bytes even at crf ${maxCrf} (${JSON.stringify(tries)})`);
}

/**
 * `zones`: [{ start, end, crf }] in frames. x264 encodes those frames at their own
 * CRF (e.g. stage-only stretches whose dithered glow the main CRF would block up).
 * `x264Params`: extra x264 options (colon-separated), appended to the defaults.
 */
export async function encodeH264(master, out, { budget, crf = 18, maxCrf = 34, crfStep = 1, gop = 120, keyintMin, preset = 'veryslow', zones, x264Params } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const params = ['aq-mode=3', 'colorprim=bt709', 'transfer=bt709', 'colormatrix=bt709'];
  if (x264Params) params.push(x264Params);
  if (zones?.length) params.push(`zones=${zones.map((z) => `${z.start},${z.end},crf=${z.crf}`).join('/')}`);
  const encodeAt = (c) =>
    run('ffmpeg', [
      '-v', 'error', '-y', '-i', master,
      '-vf', COLOR_FILTER,
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', preset, '-crf', String(c),
      '-g', String(gop), '-keyint_min', String(keyintMin ?? gop), '-bf', '3',
      '-x264-params', params.join(':'),
      ...COLOR_TAGS,
      '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
      out,
    ]);
  return fit({ encodeAt, out, budget: parseSize(budget), crf, maxCrf, step: crfStep });
}

/**
 * `tenBit`: encode 10-bit (AV1 Main, yuv420p10le). The extra precision keeps
 * smooth gradients (the stage glow) free of banding at a lower bitrate than 8-bit.
 * `svtParams`: extra -svtav1-params (colon-separated key=value).
 */
export async function encodeAV1(master, out, { budget, crf = 30, maxCrf = 50, crfStep = 2, gop = 120, preset = 4, tenBit = false, svtParams } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp.webm`;
  const pixFmt = tenBit ? 'yuv420p10le' : 'yuv420p';
  const encodeAt = async (c) => {
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', master,
      '-vf', colorFilter(pixFmt),
      '-c:v', 'libsvtav1', '-preset', String(preset), '-crf', String(c), '-g', String(gop),
      ...(svtParams ? ['-svtav1-params', svtParams] : []),
      ...COLOR_TAGS,
      '-pix_fmt', pixFmt, '-an',
      tmp,
    ]);
    // SVT-AV1 leaves colour_description out of the sequence header and the WebM
    // muxer then writes no primaries/transfer. A stream-copy remux through
    // av1_metadata fixes both (bitstream + container Colour element).
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', tmp, '-c', 'copy',
      '-bsf:v', 'av1_metadata=color_primaries=1:transfer_characteristics=1:matrix_coefficients=1:color_range=tv',
      ...COLOR_TAGS,
      out,
    ]);
    fs.rmSync(tmp, { force: true });
  };
  return fit({ encodeAt, out, budget: parseSize(budget), crf, maxCrf, step: crfStep });
}

/** Frame 0 of the master (the loop's first frame) as .webp / .jpg / .png. */
export async function poster(master, outs, { frame = 0, webpQuality = 90, jpegQuality = 3 } = {}) {
  const tmp = path.join(os.tmpdir(), `poster-${process.pid}-${Date.now()}.png`);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', master, '-vf', `select=eq(n\\,${frame}),format=rgb24`, '-frames:v', '1', tmp]);
  const results = [];
  for (const out of outs) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const ext = path.extname(out).toLowerCase();
    if (ext === '.webp') await run('cwebp', ['-quiet', '-q', String(webpQuality), '-m', '6', '-sharp_yuv', tmp, '-o', out]);
    else if (ext === '.jpg' || ext === '.jpeg') {
      await run('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-q:v', String(jpegQuality), '-pix_fmt', 'yuvj444p', out]);
    } else if (ext === '.png') fs.copyFileSync(tmp, out);
    else throw new Error(`unknown poster format ${out}`);
    results.push({ out, size: fs.statSync(out).size });
  }
  fs.rmSync(tmp, { force: true });
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, master, ...rest] = process.argv.slice(2);
  const outs = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));
  const opt = (k) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  let res;
  if (kind === 'h264') res = await encodeH264(master, outs[0], { budget: opt('budget'), crf: opt('crf') ? Number(opt('crf')) : undefined });
  else if (kind === 'av1') res = await encodeAV1(master, outs[0], { budget: opt('budget'), crf: opt('crf') ? Number(opt('crf')) : undefined });
  else if (kind === 'poster') res = await poster(master, outs);
  else {
    console.error('usage: node engine/encode.mjs h264|av1|poster <master.mkv> <out...> [--budget 5MB] [--crf N]');
    process.exit(2);
  }
  console.log(JSON.stringify(res, null, 2));
}
