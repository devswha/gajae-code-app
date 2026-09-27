// A reel is one continuous source recording, assembled from the capture clips
// that were cut from it. Clips overlap by their handles, so frames are
// de-duplicated by the raw frame they came from and put on one clock:
//
//   source seconds = (wallMs - T0) / 1000
//
// where T0 is the recording's start. Every clip frame and every logged event
// carries wallMs, so frames and events from different clips line up exactly.
// Frames are variable-rate (the screencast only emits on repaint): a frame is
// held until the next frame's timestamp.

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadReel(footageBase, clipIds) {
  const clips = await Promise.all(
    clipIds.map(async (id) => {
      const [ts, ev] = await Promise.all([
        getJson(`${footageBase}/${id}/timestamps.json`),
        getJson(`${footageBase}/${id}/events.json`),
      ]);
      return { id, ts, ev };
    }),
  );
  const source = clips[0].ts.source;
  for (const c of clips) {
    if (c.ts.source !== source) {
      throw new Error(`reel mixes recordings: ${c.id} is from ${c.ts.source}, not ${source}`);
    }
  }
  // T0 from a non-first frame (a clip's first frame is clamped to t=0 and held).
  const probe = clips[0].ts.frames[Math.min(1, clips[0].ts.frames.length - 1)];
  const T0 = probe.wallMs - (clips[0].ts.sourceWindowSec[0] + probe.t) * 1000;
  const toSource = (wallMs) => (wallMs - T0) / 1000;

  const byRaw = new Map();
  for (const c of clips) {
    for (const f of c.ts.frames) {
      if (!byRaw.has(f.rawFile)) {
        byRaw.set(f.rawFile, { t: toSource(f.wallMs), url: `${footageBase}/${c.id}/${f.file}` });
      }
    }
  }
  const frames = [...byRaw.values()].sort((a, b) => a.t - b.t);
  const times = Float64Array.from(frames.map((f) => f.t));

  const seen = new Set();
  const events = [];
  for (const c of clips) {
    for (const e of c.ev.events) {
      const key = `${e.type}|${e.wallMs}|${JSON.stringify(e.at ?? e.from ?? '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...e, clip: c.id, localT: e.t, t: toSource(e.wallMs) });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const windows = Object.fromEntries(clips.map((c) => [c.id, c.ts.sourceWindowSec]));
  const first = clips[0].ts;

  return {
    source,
    viewport: first.viewport,
    dpr: first.dpr,
    framePixels: first.framePixels,
    frames,
    events,
    start: frames[0].t,
    end: frames[frames.length - 1].t,
    /** Source seconds for a time given in a clip's own clock (as in its events.json). */
    at(clipId, localT) {
      const w = windows[clipId];
      if (!w) throw new Error(`clip ${clipId} is not part of reel ${source}`);
      return w[0] + localT;
    },
    /** The frame on screen at source second t (held until the next timestamp). */
    frameAt(t) {
      let lo = 0;
      let hi = times.length - 1;
      if (t <= times[0]) return frames[0];
      if (t >= times[hi]) return frames[hi];
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid;
      }
      return frames[lo];
    },
    /** First event matching a predicate, e.g. reel.find('mouse_down', e => e.target === 'permission:Allow'). */
    find(type, pred = () => true) {
      const e = events.find((ev) => ev.type === type && pred(ev));
      if (!e) throw new Error(`no ${type} event in reel ${source}`);
      return e;
    },
  };
}
