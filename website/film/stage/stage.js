// Stage runtime. Loads a sequence module, builds its DOM once, and exposes
//
//   window.__ready            Promise<meta>   resolves when fonts + first frame are loaded
//   window.__seek(T, opts)    Promise<void>   sets every element for timeline second T
//
// seek is a pure function of T: nothing reads the wall clock and nothing is
// animated by CSS, so the renderer can step frames in any order and get the
// same pixels. opts.frameT picks which output frame the footage frame is
// sampled for (temporal supersampling moves the camera and pointer within a
// frame but keeps one footage frame per output frame).

import { clamp01, keyframes } from './lib/easing.js';
import { createTimemap } from './lib/timemap.js';
import { loadReel } from './lib/reel.js';
import { createCamera } from './lib/camera.js';
import { ARROW_BOX, arrowSvg, buildPointerTrack } from './lib/pointer.js';

const params = new URLSearchParams(location.search);
const seqId = params.get('seq');
const FOOTAGE = '/footage';

class FramePlayer {
  constructor(parent) {
    this.front = document.createElement('img');
    this.back = document.createElement('img');
    for (const img of [this.front, this.back]) {
      img.decoding = 'sync';
      img.alt = '';
      img.style.visibility = 'hidden';
      parent.appendChild(img);
    }
    this.current = null;
  }

  async show(url) {
    if (url === this.current) return;
    const img = this.back;
    img.src = url;
    try {
      await img.decode();
    } catch {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error(`failed to load ${url}`));
        });
      }
    }
    if (img.naturalWidth === 0) throw new Error(`empty frame ${url}`);
    img.style.visibility = 'visible';
    this.front.style.visibility = 'hidden';
    this.back = this.front;
    this.front = img;
    this.current = url;
  }

  place(left, top, width, height) {
    for (const img of [this.front, this.back]) {
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
    }
  }
}

function buildShot(stage, def, seq) {
  const el = document.createElement('div');
  el.className = 'shot';
  el.dataset.shot = def.id;
  if (def.zIndex != null) el.style.zIndex = String(def.zIndex);
  // `container`: id of an element a layer built (e.g. a window's content box).
  const parent = def.container ? document.getElementById(def.container) : stage;
  if (!parent) throw new Error(`shot ${def.id}: no container #${def.container}`);
  parent.appendChild(el);
  const reel = def.reel;
  const player = new FramePlayer(el);
  const timemap = createTimemap(def.time);
  // Frame-driven shots (def.frame) are sized by their container; no crop camera.
  const camera = def.frame ? null : createCamera(def.camera, {
    viewport: reel.viewport,
    dpr: reel.dpr,
    outW: seq.width,
    outH: seq.height,
    minSourcePxPerOutPx: def.minSourcePxPerOutPx ?? 1,
  });
  const track = def.pointer ? buildPointerTrack(reel.events) : null;
  let ptr = null;
  let touch = null;
  let ring = null;
  if (def.pointer === 'arrow') {
    ptr = document.createElement('div');
    ptr.className = 'ptr';
    ptr.innerHTML = arrowSvg(def.id);
    el.appendChild(ptr);
  } else if (def.pointer === 'touch') {
    ring = document.createElement('div');
    ring.className = 'touch-ring';
    touch = document.createElement('div');
    touch.className = 'touch';
    el.appendChild(ring);
    el.appendChild(touch);
  }
  const offset = def.offset ?? 0;
  const start = def.start ?? -Infinity;
  const end = def.end ?? Infinity;

  return {
    def,
    timemap,
    camera,
    async seek(T, frameT) {
      const opacity = def.opacity ? keyframes(def.opacity, T) : 1;
      if (T < start || T >= end || opacity <= 0) {
        el.style.display = 'none';
        return null;
      }
      el.style.display = 'block';
      el.style.opacity = String(clamp01(opacity));
      const local = T - offset;
      const src = timemap(local);
      let ft = timemap(frameT - offset);
      // `skip` hides transient frames (e.g. a 40 ms flash) by holding the frame before them.
      for (const [a, b] of def.skip ?? []) if (ft >= a && ft < b) ft = a - 1e-4;
      const frame = reel.frameAt(ft);
      await player.show(frame.url);
      // `frame(T)` -> {w}: the shot fills its container, which a layer sizes and
      // moves (a film camera over a window); the whole viewport is shown at w/vw.
      let r;
      if (def.frame) {
        const box = def.frame(T);
        const sc = box.w / reel.viewport.width;
        if (sc > reel.dpr * (1 + 1e-3)) {
          throw new Error(`shot ${def.id} at T=${T.toFixed(3)} zooms past native: ${sc.toFixed(3)} > dpr ${reel.dpr}`);
        }
        r = { x: 0, y: 0, w: reel.viewport.width, h: reel.viewport.height, scale: sc };
      } else r = camera.rectAt(local);
      const s = r.scale; // output px per CSS px
      player.place(-r.x * s, -r.y * s, reel.viewport.width * s, reel.viewport.height * s);

      if (ptr) {
        const vis = def.pointerOpacity ? keyframes(def.pointerOpacity, T) : 1;
        const p = track.position(src);
        if (!p || vis <= 0) ptr.style.display = 'none';
        else {
          const press = 1 - 0.16 * track.pressAmount(src);
          const size = s * (def.pointerScale ?? 1) * press;
          ptr.style.display = 'block';
          ptr.style.opacity = String(clamp01(vis));
          ptr.style.left = `${(p.x - r.x) * s + ARROW_BOX.ox * size}px`;
          ptr.style.top = `${(p.y - r.y) * s + ARROW_BOX.oy * size}px`;
          ptr.style.width = `${ARROW_BOX.w * size}px`;
          ptr.style.height = `${ARROW_BOX.h * size}px`;
        }
      }
      if (touch) {
        const st = track.touch(src);
        if (!st) {
          touch.style.display = 'none';
          ring.style.display = 'none';
        } else {
          const base = 40 * s * (def.pointerScale ?? 1);
          const cx = (st.x - r.x) * s;
          const cy = (st.y - r.y) * s;
          const d = base * st.scale;
          touch.style.display = 'block';
          touch.style.opacity = String(st.opacity);
          touch.style.left = `${cx - d / 2}px`;
          touch.style.top = `${cy - d / 2}px`;
          touch.style.width = `${d}px`;
          touch.style.height = `${d}px`;
          const rd = base * st.ring;
          ring.style.display = st.ringOpacity > 0 ? 'block' : 'none';
          ring.style.opacity = String(st.ringOpacity);
          ring.style.left = `${cx - rd / 2}px`;
          ring.style.top = `${cy - rd / 2}px`;
          ring.style.width = `${rd}px`;
          ring.style.height = `${rd}px`;
          ring.style.borderWidth = `${Math.max(1, 2 * s)}px`;
        }
      }
      return { shot: def.id, src, speed: timemap.speedAt(local), frame: frame.url.split('/').slice(-3).join('/'), rect: r };
    },
  };
}

async function main() {
  if (!seqId || !/^[a-z0-9-]+$/.test(seqId)) throw new Error('missing or invalid ?seq=');
  const mod = await import(`../sequences/${seqId}.js`);
  const reels = new Map();
  const api = {
    footageBase: FOOTAGE,
    async reel(clipIds) {
      const key = clipIds.join('+');
      if (!reels.has(key)) reels.set(key, loadReel(FOOTAGE, clipIds));
      return reels.get(key);
    },
  };
  const seq = await mod.default(api);
  const stage = document.getElementById('stage');
  stage.style.width = `${seq.width}px`;
  stage.style.height = `${seq.height}px`;
  stage.style.background = seq.background ?? '#0d0b09';
  // Layers mount first so they can build containers that shots go into.
  const layers = [];
  for (const layer of seq.layers ?? []) {
    await layer.mount?.(stage, api);
    layers.push(layer);
  }
  const shots = seq.shots.map((def) => buildShot(stage, def, seq));
  let debugEl = null;
  if (params.get('debug')) {
    debugEl = document.createElement('div');
    debugEl.id = 'debug';
    stage.appendChild(debugEl);
  }

  let chain = Promise.resolve();
  async function seekNow(T, opts = {}) {
    const frameT = opts.frameT ?? T;
    const infos = await Promise.all(shots.map((s) => s.seek(T, frameT)));
    for (const layer of layers) await layer.seek?.(T, opts);
    if (debugEl) {
      debugEl.textContent =
        `T ${T.toFixed(3)}\n` +
        infos
          .filter(Boolean)
          .map((i) => `${i.shot}: src ${i.src.toFixed(3)} x${i.speed.toFixed(2)} ${i.frame} w${i.rect.w.toFixed(0)}`)
          .join('\n');
    }
  }
  // Serialise seeks so a slow decode can never interleave two frames.
  window.__seek = (T, opts) => {
    chain = chain.then(() => seekNow(T, opts));
    return chain;
  };

  await document.fonts.ready;
  await window.__seek(0);
  const meta = {
    id: seq.id ?? seqId,
    width: seq.width,
    height: seq.height,
    fps: seq.fps ?? 60,
    duration: seq.duration,
    supersample: seq.supersample ?? 1,
    chapters: seq.chapters ?? null,
    // encoder hints a sequence can pass to build.mjs (e.g. film CRF zones, in seconds)
    encodeHints: seq.encodeHints ?? null,
    shots: shots.map((s) => ({ id: s.def.id, anchors: s.timemap.anchors })),
  };
  window.__meta = meta;

  if (params.get('play')) {
    // Authoring preview only: real-time playback, looping. Never used by the renderer.
    const t0 = performance.now();
    const loop = async () => {
      const T = (((performance.now() - t0) / 1000) % seq.duration + seq.duration) % seq.duration;
      await window.__seek(T);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return meta;
}

window.__ready = main().catch((err) => {
  window.__error = String(err?.stack ?? err);
  document.body.style.background = '#400';
  document.body.textContent = window.__error;
  throw err;
});
