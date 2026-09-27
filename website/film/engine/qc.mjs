#!/usr/bin/env node
// Quality control for a delivered video.
//
//   node engine/qc.mjs <video> [--expect 1920x1200@60] [--budget 5MB] [--min 14 --max 20]
//        [--frames 0,4.5,9,last] [--dir qc-out]
//
// Reports: container/codec/profile/pix_fmt/colour tags, dimensions, fps,
// duration, audio streams (must be 0), size vs budget, the darkest frame's mean
// luma (black-frame check), and the loop seam: PSNR between the last and first
// frame compared with a typical neighbouring-frame PSNR. It also writes PNG
// frames at the requested times (and a last|first seam pair) for eyeballing.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSize } from './encode.mjs';

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
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} ${code}: ${err.slice(-1500)}`))));
  });
}

async function psnr(video, a, b) {
  // PSNR (Y) between frame a and frame b of the same file.
  const { err } = await run('ffmpeg', [
    '-v', 'info', '-i', video, '-i', video,
    '-filter_complex',
    `[0:v]select=eq(n\\,${a}),setpts=0[x];[1:v]select=eq(n\\,${b}),setpts=0[y];[x][y]psnr`,
    '-frames:v', '1', '-f', 'null', '-',
  ]);
  const m = /average:([\d.]+|inf)/.exec(err);
  return m ? (m[1] === 'inf' ? Infinity : Number(m[1])) : null;
}

export async function qc(video, { expect, budget, min, max, frames = [], dir } = {}) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-count_frames', '-of', 'json', video]);
  const info = JSON.parse(out);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.filter((s) => s.codec_type === 'audio').length;
  const [n, d] = v.r_frame_rate.split('/').map(Number);
  const fps = n / d;
  const nFrames = Number(v.nb_read_frames);
  const duration = Number(info.format.duration);
  const size = fs.statSync(video).size;
  const report = {
    file: video,
    codec: v.codec_name,
    profile: v.profile,
    pix_fmt: v.pix_fmt,
    color: { range: v.color_range, space: v.color_space, transfer: v.color_transfer, primaries: v.color_primaries },
    width: v.width,
    height: v.height,
    fps,
    frames: nFrames,
    duration,
    audioStreams: audio,
    size,
    faststart: null,
    problems: [],
  };
  if (/\.mp4$/i.test(video)) {
    // +faststart: the moov atom comes before mdat.
    const head = fs.readFileSync(video).subarray(0, Math.min(size, 1 << 20)).toString('latin1');
    const moov = head.indexOf('moov');
    const mdat = head.indexOf('mdat');
    report.faststart = moov >= 0 && (mdat < 0 || moov < mdat);
    if (!report.faststart) report.problems.push('moov atom is not at the front (+faststart missing)');
  }
  if (audio) report.problems.push(`has ${audio} audio stream(s)`);
  if (expect) {
    const m = /^(\d+)x(\d+)(?:@(\d+))?$/.exec(expect);
    if (Number(m[1]) !== v.width || Number(m[2]) !== v.height) report.problems.push(`size ${v.width}x${v.height} != ${m[1]}x${m[2]}`);
    if (m[3] && Math.abs(Number(m[3]) - fps) > 0.01) report.problems.push(`fps ${fps} != ${m[3]}`);
  }
  if (budget && size > parseSize(budget)) report.problems.push(`size ${size} > budget ${budget}`);
  if (min != null && duration < min - 0.02) report.problems.push(`duration ${duration} < ${min}`);
  if (max != null && duration > max + 0.02) report.problems.push(`duration ${duration} > ${max}`);
  if (v.color_space !== 'bt709' || v.color_primaries !== 'bt709' || v.color_transfer !== 'bt709') {
    report.problems.push('missing bt709 colour tags');
  }

  // Darkest / brightest frame mean luma across the whole clip.
  const { err: stats } = await run('ffmpeg', [
    '-v', 'info', '-i', video, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-',
  ]);
  const yavg = [...stats.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  report.lumaMin = Math.min(...yavg);
  report.lumaMax = Math.max(...yavg);
  if (report.lumaMin < 16.5) report.problems.push(`a frame is black (YAVG ${report.lumaMin})`);
  // Largest jump in mean luma between neighbouring frames (flash / half-rendered frame check).
  let jump = 0;
  let at = 0;
  for (let i = 1; i < yavg.length; i += 1) {
    const dlt = Math.abs(yavg[i] - yavg[i - 1]);
    if (dlt > jump) {
      jump = dlt;
      at = i;
    }
  }
  report.maxLumaJump = { delta: Number(jump.toFixed(2)), frame: at, t: Number((at / fps).toFixed(3)) };
  report.seamLumaJump = yavg.length > 1 ? Number(Math.abs(yavg[0] - yavg[yavg.length - 1]).toFixed(2)) : 0;

  report.seam = {
    psnrLastToFirst: await psnr(video, nFrames - 1, 0),
    psnrNeighbours: await psnr(video, Math.floor(nFrames / 2), Math.floor(nFrames / 2) + 1),
  };

  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(video).replace(/\.[^.]+$/, '');
    const shots = [];
    for (const f of frames) {
      const idx = f === 'last' ? nFrames - 1 : Math.min(nFrames - 1, Math.round(Number(f) * fps));
      const file = path.join(dir, `${base}_f${String(idx).padStart(5, '0')}.png`);
      await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', `select=eq(n\\,${idx})`, '-frames:v', '1', file]);
      shots.push(file);
    }
    const seam = path.join(dir, `${base}_seam_last-first.png`);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', video, '-i', video, '-filter_complex',
      `[0:v]select=eq(n\\,${nFrames - 1}),setpts=0[a];[1:v]select=eq(n\\,0),setpts=0[b];[a][b]hstack`,
      '-frames:v', '1', seam,
    ]);
    shots.push(seam);
    report.frameFiles = shots;
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [video, ...rest] = process.argv.slice(2);
  const opt = (k) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const report = await qc(video, {
    expect: opt('expect'),
    budget: opt('budget'),
    min: opt('min') != null ? Number(opt('min')) : undefined,
    max: opt('max') != null ? Number(opt('max')) : undefined,
    frames: opt('frames') ? opt('frames').split(',') : [],
    dir: opt('dir'),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length) process.exitCode = 1;
}
