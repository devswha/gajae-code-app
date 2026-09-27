#!/usr/bin/env node
// Deterministic renderer: steps a stage sequence frame by frame in headless
// Chromium and pipes PNG screenshots straight into ffmpeg (image2pipe). No
// frame dump touches the disk; the output is a lossless RGB master (FFV1/MKV)
// that encode.mjs turns into the web deliverables.
//
//   node engine/render.mjs <sequence-id> [--out master.mkv] [--workers 4]
//        [--ss 2] [--from 0] [--to 3.5] [--stills 0,4.2,9] [--stills-dir dir]
//
// --ss N     temporal supersampling: N sub-frames per output frame spread over a
//            180-degree shutter, averaged by ffmpeg tmix (motion blur on fast
//            camera/pointer moves). Footage stays on one frame per output frame.
// --workers  parallel Chromium pages, each rendering a contiguous chunk; the
//            chunks are concatenated losslessly.
// --stills   render single frames (no supersampling) as PNG for review.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, FILM_DIR } from './server.mjs';

const SHUTTER = 0.5; // fraction of a frame interval the virtual shutter is open

export function workDir() {
  const dir = process.env.FILM_WORK_DIR ?? path.join(os.tmpdir(), 'gajae-film-work');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (err) {
    const dir = process.env.FILM_PLAYWRIGHT_DIR;
    if (!dir) {
      throw new Error(
        'playwright is not installed. Run `npm install` in website/film, or set FILM_PLAYWRIGHT_DIR to a folder whose node_modules has playwright.',
        { cause: err },
      );
    }
    const require = createRequire(path.join(path.resolve(dir), 'package.json'));
    return require('playwright');
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    } else args._.push(a);
  }
  return args;
}

function ffmpeg(args, { input = 'pipe' } = {}) {
  const proc = spawn('ffmpeg', args, { stdio: [input, 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d;
  });
  const done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`)),
    );
  });
  return { proc, done };
}

function write(stream, buf) {
  // Errors surface through the ffmpeg process's exit code (see ffmpeg()).
  return new Promise((resolve) => {
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

async function openStage(browser, origin, seqId, size) {
  const context = await browser.newContext({
    viewport: size ?? { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${origin}/stage/?seq=${seqId}`);
  const meta = await page.evaluate(async () => {
    try {
      return await window.__ready;
    } catch {
      return { error: window.__error };
    }
  });
  if (!meta || meta.error) throw new Error(`stage failed: ${meta?.error ?? errors.join('\n')}`);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, meta, errors };
}

async function shoot(cdp) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    optimizeForSpeed: true,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return Buffer.from(data, 'base64');
}

/** Load a sequence in the stage and return its meta (size, fps, duration, chapters...). */
export async function probe(seqId) {
  const { chromium } = await loadPlaywright();
  const { origin, close } = await startServer();
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
  try {
    const st = await openStage(browser, origin, seqId);
    await st.context.close();
    return st.meta;
  } finally {
    await browser.close();
    await close();
  }
}

export async function render(seqId, opts = {}) {
  const { chromium } = await loadPlaywright();
  const { origin, close } = await startServer();
  const browser = await chromium.launch({
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const t0 = Date.now();
  try {
    const probe = await openStage(browser, origin, seqId);
    const meta = probe.meta;
    await probe.context.close();
    const size = { width: meta.width, height: meta.height };
    const fps = meta.fps;

    if (opts.stills) {
      const dir = opts.stillsDir ?? path.join(workDir(), `${seqId}-stills`);
      fs.mkdirSync(dir, { recursive: true });
      const st = await openStage(browser, origin, seqId, size);
      const out = [];
      for (const T of opts.stills) {
        await st.page.evaluate((t) => window.__seek(t), T);
        const file = path.join(dir, `${seqId}_${T.toFixed(3)}.png`);
        fs.writeFileSync(file, await shoot(st.cdp));
        out.push(file);
      }
      await st.context.close();
      return { stills: out };
    }

    const ss = Math.max(1, Number(opts.ss ?? meta.supersample ?? 1));
    const from = Math.round((opts.from ?? 0) * fps);
    const to = Math.round((opts.to ?? meta.duration) * fps);
    const total = to - from;
    const workers = Math.max(1, Math.min(Number(opts.workers ?? 4), Math.ceil(total / 30)));
    const out = opts.out ?? path.join(workDir(), `${seqId}.mkv`);
    const chunkDir = `${out}.chunks`;
    fs.rmSync(chunkDir, { recursive: true, force: true });
    fs.mkdirSync(chunkDir, { recursive: true });

    const vf = ['format=gbrp'];
    if (ss > 1) {
      vf.push(`tmix=frames=${ss}`, `select='eq(mod(n\\,${ss})\\,${ss - 1})'`, `setpts=N/(${fps}*TB)`);
    }
    let doneFrames = 0;
    const per = Math.ceil(total / workers);
    const chunks = [];
    for (let w = 0; w < workers; w += 1) {
      const a = from + w * per;
      const b = Math.min(to, a + per);
      if (a < b) chunks.push({ a, b, file: path.join(chunkDir, `chunk-${String(w).padStart(2, '0')}.mkv`) });
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        const st = await openStage(browser, origin, seqId, size);
        const enc = ffmpeg([
          '-v', 'error', '-y',
          '-f', 'image2pipe', '-framerate', String(fps * ss), '-c:v', 'png', '-i', '-',
          '-vf', vf.join(','),
          '-r', String(fps),
          '-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '4', '-pix_fmt', 'gbrp',
          chunk.file,
        ]);
        for (let k = chunk.a; k < chunk.b; k += 1) {
          const base = k / fps;
          for (let j = 0; j < ss; j += 1) {
            // sub-frames at the centres of N equal slices of a 180-degree shutter around `base`
            const T = ss > 1 ? base + ((j + 0.5) / ss - 0.5) * (SHUTTER / fps) : base;
            await st.page.evaluate(([t, f]) => window.__seek(t, { frameT: f }), [T, base]);
            await write(enc.proc.stdin, await shoot(st.cdp));
          }
          doneFrames += 1;
          if (doneFrames % 60 === 0 && !opts.quiet) {
            const el = (Date.now() - t0) / 1000;
            process.stderr.write(`\r${seqId}: ${doneFrames}/${total} frames  ${(doneFrames / el).toFixed(1)} fps`);
          }
        }
        enc.proc.stdin.end();
        await enc.done;
        if (st.errors.length) throw new Error(`page errors in ${seqId}: ${st.errors.join('\n')}`);
        await st.context.close();
      }),
    );
    if (!opts.quiet) process.stderr.write('\n');

    const list = path.join(chunkDir, 'list.txt');
    fs.writeFileSync(list, chunks.map((c) => `file '${c.file}'`).join('\n'));
    await ffmpeg(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { input: 'ignore' }).done;
    fs.rmSync(chunkDir, { recursive: true, force: true });
    const secs = (Date.now() - t0) / 1000;
    if (!opts.quiet) console.error(`${seqId}: ${total} frames (${ss}x supersampled) in ${secs.toFixed(1)} s -> ${out}`);
    return { out, meta, frames: total, seconds: secs };
  } finally {
    await browser.close();
    await close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(FILM_DIR, 'engine', 'render.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const seqId = args._[0];
  if (!seqId) {
    console.error('usage: node engine/render.mjs <sequence-id> [--out f.mkv] [--workers N] [--ss N] [--from s] [--to s] [--stills t1,t2]');
    process.exit(2);
  }
  const res = await render(seqId, {
    out: args.out,
    workers: args.workers,
    ss: args.ss,
    from: args.from != null ? Number(args.from) : undefined,
    to: args.to != null ? Number(args.to) : undefined,
    stills: args.stills ? String(args.stills).split(',').map(Number) : undefined,
    stillsDir: args['stills-dir'],
  });
  console.log(JSON.stringify(res, null, 2));
}
