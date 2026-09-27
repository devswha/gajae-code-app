#!/usr/bin/env node
// Render + encode + QC the film and the UI loops listed in MEDIA-CONTRACT (website/public/media).
//
//   node engine/build.mjs                 # everything below
//   node engine/build.mjs hero work       # only these jobs
//   node engine/build.mjs --skip-render   # re-encode from existing masters
//
// Masters (lossless FFV1) go to $FILM_WORK_DIR (default: <tmp>/gajae-film-work).

import fs from 'node:fs';
import path from 'node:path';
import { probe, render, workDir } from './render.mjs';
import { encodeAV1, encodeH264, poster } from './encode.mjs';
import { qc } from './qc.mjs';
import { WEBSITE_DIR } from './server.mjs';

const MEDIA = process.env.FILM_MEDIA_DIR ?? path.join(WEBSITE_DIR, 'public', 'media');

// Budgets: the contract's hard cap, minus a little headroom.
export const JOBS = {
  hero: {
    seq: 'hero-loop',
    expect: '1920x1200@60',
    range: [14, 20],
    h264: { out: 'hero/hero-loop.mp4', budget: '4.8MB', crf: 18 },
    av1: { out: 'hero/hero-loop.webm', budget: '3.8MB', crf: 24 },
    // WebP only: the page's poster attribute and its preload take the webp; nothing
    // references a JPEG hero poster, so none is exported.
    posters: ['hero/hero-poster.webp'],
  },
  // The produced film: chapter cards, window, stage. Poster = a chosen frame, not frame 0.
  film: {
    seq: 'film',
    expect: '1920x1080@60',
    range: [65, 85],
    workers: 8,
    // 5 s GOP with scene-cut keyframes: a 2 s GOP spends ~8% more on I-frames of static UI.
    // The sequence's encodeHints.zones (cold open, outro) get zoneCrf: at the main CRF
    // their dithered glow blocks up. deblock -1 / psy-trellis keep that dither as texture.
    h264: {
      out: 'film/gajae-code-app-film.mp4', budget: '11.8MB', crf: 27, crfStep: 0.5, gop: 300, keyintMin: 30,
      zoneCrf: 21, x264Params: 'deblock=-1,-1:psy-rd=1.0,0.15',
    },
    // No WebM for the film: MEDIA-CONTRACT ships the H.264 only and the page plays only
    // that. A tested AV1 (10-bit, svt film-grain 6-8, CRF 34-38) blocked the dark
    // cold-open glow worse than this H.264 at its zone CRF, and at the full film's
    // size it would push public/media past its 40 MB budget.
    posters: ['film/film-poster.webp', 'film/film-poster.jpg'],
    // The cold open: the mark, "Gajae Code App" and the tagline. No numbered chapter
    // card (the page numbers its own chapters) and no half-size UI under a title.
    posterAt: 4.0,
    chapters: 'film/chapters.json',
  },
  work: feature('work'),
  permission: feature('permission'),
  review: feature('review'),
  model: feature('model'),
  states: feature('states'),
  worktree: feature('worktree'),
  phone: { ...feature('phone'), expect: '780x1688@60' },
};

function feature(id) {
  return {
    seq: `feature-${id}`,
    expect: '1600x1000@60',
    range: [6, 10],
    h264: { out: `features/${id}.mp4`, budget: '1.75MB', crf: 17 },
    posters: [`features/${id}-poster.webp`],
  };
}

const args = process.argv.slice(2);
const skipRender = args.includes('--skip-render');
const names = args.filter((a) => !a.startsWith('--'));
const selected = names.length ? names : Object.keys(JOBS);
const summary = [];

for (const name of selected) {
  const job = JOBS[name];
  if (!job) throw new Error(`unknown job ${name}; known: ${Object.keys(JOBS).join(', ')}`);
  const master = path.join(workDir(), `${job.seq}.mkv`);
  if (!skipRender || !fs.existsSync(master)) await render(job.seq, { out: master, workers: job.workers ?? 6 });
  const out = (p) => path.join(MEDIA, p);
  const res = { job: name };
  const fps = Number(job.expect.split('@')[1]);
  const h264 = { ...job.h264 };
  if (job.h264.zoneCrf != null) {
    const meta = await probe(job.seq);
    const last = Math.round(meta.duration * fps) - 1;
    h264.zones = (meta.encodeHints?.zones ?? []).map((z) => ({
      start: Math.max(0, Math.round(z.from * fps)),
      end: Math.min(last, Math.round(z.to * fps)),
      crf: job.h264.zoneCrf,
    }));
  }
  res.h264 = await encodeH264(master, out(job.h264.out), h264);
  if (job.av1) res.av1 = await encodeAV1(master, out(job.av1.out), job.av1);
  const posterFrame = job.posterAt != null ? Math.round(job.posterAt * fps) : 0;
  res.posters = await poster(master, job.posters.map(out), { frame: posterFrame });
  if (job.chapters) {
    const meta = await probe(job.seq);
    const chapters = (meta.chapters ?? []).map((c) => ({ t: Number(c.t.toFixed(2)), title: c.title }));
    fs.writeFileSync(out(job.chapters), `${JSON.stringify(chapters, null, 2)}\n`);
    res.chapters = chapters.length;
  }
  res.qc = [];
  for (const enc of [job.h264, job.av1].filter(Boolean)) {
    const r = await qc(out(enc.out), {
      expect: job.expect,
      budget: enc.budget,
      min: job.range[0],
      max: job.range[1],
    });
    res.qc.push({ file: enc.out, crf: (enc === job.h264 ? res.h264 : res.av1).crf, size: r.size, duration: r.duration, problems: r.problems, seam: r.seam, lumaMin: r.lumaMin, maxLumaJump: r.maxLumaJump });
  }
  // World-readable like the rest of public/ (a static server running as another user must read them).
  for (const rel of [job.h264.out, job.av1?.out, ...job.posters, job.chapters].filter(Boolean)) {
    fs.chmodSync(out(rel), 0o644);
    fs.chmodSync(path.dirname(out(rel)), 0o755);
  }
  summary.push(res);
  console.error(JSON.stringify(res.qc));
}
console.log(JSON.stringify(summary, null, 2));
