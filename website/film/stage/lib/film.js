// Film kit: the produced-film layers that sit around the real footage.
//
//   worldCamera   eased {cx, cy, k} keys over a "world" whose unit is one CSS px
//                 of the desktop capture (the window's content origin is 0,0).
//                 k = output px per world unit; zoom interpolates in log space.
//   backdrop      warm-dark stage, slow ambient orange / visor-green glow with
//                 parallax against the camera, static dither against banding.
//   macWindow     macOS window chrome (traffic lights, hairline, layered shadow)
//                 whose content box is a container a footage shot fills.
//   phoneFrame    a generic modern phone (drawn here, no vendor artwork) whose
//                 screen is a container for the phone footage.
//   titleCard     eyebrow (Geist Mono) + chapter line (Gajae Web Sans) with a
//                 kinetic reveal: sweeping mask, per-word blur-to-sharp and rise.
//   speedBadge    tiny mono "x6" pill while a wait is time-lapsed.
//   coldOpen      the real mark (public/brand/mark.svg) powered on part by part.
//   outro         mascot, sign-off lines, download line and URL.
//   edgeFade      a soft stage-coloured falloff on one frame edge, for close-ups
//                 whose crop has to run through a line of prose.
//
// Every seek(T) is a pure function of T, like the rest of the stage.

import { clamp01, easeFn, keyframes, lerp, progress, ease } from './easing.js';

export const W = 1920;
export const H = 1080;

const css = (el, styles) => {
  for (const [k, v] of Object.entries(styles)) el.style[k] = v;
  return el;
};
const div = (cls, parent, styles = {}) => {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  css(el, { position: 'absolute', ...styles });
  parent?.appendChild(el);
  return el;
};
const px = (v) => `${v.toFixed(3)}px`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .fk-tl { position:absolute; border-radius:50%; box-sizing:border-box; }
    .fk-title { color:#EEEAE3; white-space:nowrap; }
    .fk-eyebrow { font-family:var(--mono); text-transform:uppercase; color:#8F8A82; font-weight:500;
      letter-spacing:0.16em; font-size:15px; line-height:1; display:flex; gap:0.9em; align-items:center; }
    .fk-eyebrow b { color:#F2552C; font-weight:500; }
    .fk-line { font-family:var(--sans); font-weight:620; letter-spacing:-0.038em; line-height:1.02;
      -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 44%,transparent 56%,transparent 100%);
      -webkit-mask-size:230% 100%; -webkit-mask-repeat:no-repeat; font-feature-settings:"ss06","kern"; }
    .fk-w { display:inline-block; white-space:pre; will-change:auto; }
    .fk-sub { font-family:var(--sans); font-weight:450; color:#A39E96; letter-spacing:-0.01em; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------- camera

export function worldCamera(keys) {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  for (const k of sorted) if (!(k.k > 0)) throw new Error(`camera key at ${k.at}: bad k`);
  const at = (t) => {
    if (t <= sorted[0].at) return { ...sorted[0] };
    const last = sorted[sorted.length - 1];
    if (t >= last.at) return { ...last };
    for (let i = 1; i < sorted.length; i += 1) {
      const k1 = sorted[i];
      if (t <= k1.at) {
        const k0 = sorted[i - 1];
        const u = easeFn(k1.ease)(progress(t, k0.at, k1.at));
        return {
          cx: lerp(k0.cx, k1.cx, u),
          cy: lerp(k0.cy, k1.cy, u),
          k: k0.k === k1.k ? k0.k : Math.exp(lerp(Math.log(k0.k), Math.log(k1.k), u)),
        };
      }
    }
    return { ...last };
  };
  at.keys = sorted;
  return at;
}

export const toScreen = (cam, wx, wy) => ({ x: W / 2 + (wx - cam.cx) * cam.k, y: H / 2 + (wy - cam.cy) * cam.k });

// ---------------------------------------------------------------- backdrop

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function backdrop({ camera, intensity = [{ at: 0, v: 1 }] }) {
  let root;
  let glowA;
  let glowB;
  let glowC;
  return {
    mount(stage) {
      injectStyle();
      root = div('fk-backdrop', stage, { inset: '0', background: '#0D0B09', zIndex: '0', overflow: 'hidden' });
      glowA = div('', root, {
        width: '1700px', height: '1700px', left: '0', top: '0',
        background: 'radial-gradient(closest-side, rgba(242,85,44,0.20), rgba(242,85,44,0.085) 42%, rgba(242,85,44,0.025) 72%, rgba(242,85,44,0) 100%)',
      });
      glowB = div('', root, {
        width: '1500px', height: '1500px', left: '0', top: '0',
        background: 'radial-gradient(closest-side, rgba(131,252,165,0.085), rgba(131,252,165,0.035) 45%, rgba(131,252,165,0) 100%)',
      });
      glowC = div('', root, {
        width: '2200px', height: '900px', left: '0', top: '0',
        background: 'radial-gradient(closest-side, rgba(255,181,43,0.05), rgba(255,181,43,0) 100%)',
      });
      div('', root, {
        inset: '0',
        background: 'radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.42) 100%)',
      });
      // Static dither: +-1-2 code values of triangular noise, overlay-blended. Breaks
      // up 8-bit banding in the glows without costing bits frame to frame.
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      css(cv, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px`, mixBlendMode: 'overlay', opacity: '0.55' });
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(W, H);
      const rnd = mulberry32(0x6a6a1e);
      for (let i = 0; i < W * H; i += 1) {
        const n = (rnd() + rnd() - 1) * 26;
        const v = Math.round(128 + n);
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      root.appendChild(cv);
    },
    seek(T) {
      const cam = camera(T);
      const inten = keyframes(intensity, T);
      // Parallax: the stage drifts at a small fraction of the camera's travel.
      const pxl = -(cam.cx - 720) * cam.k * 0.07;
      const pyl = -(cam.cy - 400) * cam.k * 0.07;
      const zs = Math.pow(cam.k / 0.85, 0.12);
      const place = (el, size, x, y, sx = 1) => {
        el.style.transform = `translate(${px(x - size.w / 2)}, ${px(y - size.h / 2)}) scale(${(zs * sx).toFixed(4)})`;
      };
      const a = (2 * Math.PI) / 3; // slow: the drift must stay cheap to encode on holds
      place(glowA, { w: 1700, h: 1700 }, 380 + 70 * Math.sin((a * T) / 29) + pxl, 900 + 50 * Math.cos((a * T) / 23) + pyl);
      place(glowB, { w: 1500, h: 1500 }, 1620 + 60 * Math.cos((a * T) / 31) + pxl * 1.3, 150 + 50 * Math.sin((a * T) / 27) + pyl * 1.3);
      place(glowC, { w: 2200, h: 900 }, 960 + pxl * 0.6, 1130 + pyl * 0.6);
      glowA.style.opacity = String(clamp01(inten * (0.92 + 0.08 * Math.sin((a * T) / 11))));
      glowB.style.opacity = String(clamp01(inten * (0.9 + 0.1 * Math.cos((a * T) / 13))));
      glowC.style.opacity = String(clamp01(inten));
    },
  };
}

// ---------------------------------------------------------------- mac window

/**
 * @param id        id of the content container (shots use it as `container`)
 * @param camera    worldCamera
 * @param state(T)  -> {opacity, dx, dy, scale, blur} extra screen-space motion
 * World: content box at (0,0)-(w,h), title bar above it.
 */
export function macWindow({ id, camera, w = 1440, h = 900, bar = 30, radius = 13, state = () => ({}), zIndex = 10 }) {
  let win;
  let barEl;
  let content;
  let edge;
  let lights;
  const box = (T) => {
    const cam = camera(T);
    const st = state(T);
    const k = cam.k * (st.scale ?? 1);
    const c = toScreen(cam, w / 2, (h - bar) / 2);
    const cx = c.x + (st.dx ?? 0);
    const cy = c.y + (st.dy ?? 0);
    const left = cx - (w / 2) * k;
    const top = cy - ((h + bar) / 2) * k;
    return { k, left, top, width: w * k, height: (h + bar) * k, cw: w * k, ch: h * k, bar: bar * k, st };
  };
  return {
    box,
    frame: (T) => ({ w: box(T).cw }),
    mount(stage) {
      injectStyle();
      win = div('fk-window', stage, { overflow: 'hidden', zIndex: String(zIndex), background: '#141414' });
      barEl = div('fk-bar', win, {
        left: '0', top: '0', right: '0',
        background: 'linear-gradient(180deg, #252321 0%, #1d1c1a 100%)',
      });
      div('', barEl, { left: '0', right: '0', bottom: '0', height: '1px', background: 'rgba(0,0,0,0.55)' });
      div('', barEl, { left: '0', right: '0', top: '0', height: '1px', background: 'rgba(255,255,255,0.06)' });
      lights = ['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) =>
        div('fk-tl', barEl, {
          background: c,
          border: `0.5px solid ${['rgba(0,0,0,0.28)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0.22)'][i]}`,
        }),
      );
      content = div('fk-content', win, { left: '0', overflow: 'hidden', background: '#141414' });
      content.id = id;
      edge = div('fk-edge', win, {
        inset: '0', pointerEvents: 'none', zIndex: '50',
        boxShadow: 'inset 0 0 0 1px rgba(255,240,220,0.11)',
      });
    },
    seek(T) {
      const b = box(T);
      const op = b.st.opacity ?? 1;
      if (op <= 0.001) {
        win.style.display = 'none';
        return;
      }
      win.style.display = 'block';
      const k = b.k;
      css(win, {
        left: px(b.left), top: px(b.top), width: px(b.width), height: px(b.height),
        borderRadius: px(radius * k), opacity: String(clamp01(op)),
        filter: b.st.blur ? `blur(${b.st.blur.toFixed(2)}px)` : 'none',
        boxShadow: [
          `0 ${px(1 * k)} ${px(2 * k)} rgba(0,0,0,0.30)`,
          `0 ${px(10 * k)} ${px(24 * k)} rgba(0,0,0,0.30)`,
          `0 ${px(34 * k)} ${px(80 * k)} rgba(0,0,0,0.42)`,
          `0 ${px(70 * k)} ${px(160 * k)} rgba(0,0,0,0.38)`,
        ].join(', '),
      });
      edge.style.borderRadius = px(radius * k);
      css(barEl, { height: px(b.bar) });
      const d = 12 * k;
      lights.forEach((el, i) => css(el, { width: px(d), height: px(d), left: px((13 + 20 * i) * k), top: px(b.bar / 2 - d / 2) }));
      css(content, { top: px(b.bar), width: px(b.cw), height: px(b.ch) });
    },
  };
}

// ---------------------------------------------------------------- phone

/**
 * A generic slab phone. World placement: screen top-left at (wx, wy), `ps` world
 * units per phone CSS px. The screen is a 390x844 container for the footage.
 */
export function phoneFrame({ id, camera, wx, wy, ps = 1, sw = 390, sh = 844, state = () => ({}), zIndex = 20 }) {
  let body;
  let rim;
  let bezel;
  let screen;
  let btns;
  const BZ = 13; // bezel, phone CSS px
  const R = 56; // outer radius
  const box = (T) => {
    const cam = camera(T);
    const st = state(T);
    const s = cam.k * ps * (st.scale ?? 1);
    const c = toScreen(cam, wx + (sw * ps) / 2, wy + (sh * ps) / 2);
    const cx = c.x + (st.dx ?? 0);
    const cy = c.y + (st.dy ?? 0);
    return { s, sx: cx - (sw / 2) * s, sy: cy - (sh / 2) * s, sw: sw * s, sh: sh * s, st };
  };
  return {
    box,
    frame: (T) => ({ w: box(T).sw }),
    mount(stage) {
      body = div('fk-phone', stage, { zIndex: String(zIndex) });
      btns = [0, 1, 2].map(() => div('', body, { background: 'linear-gradient(90deg,#2c2926,#191715)' }));
      rim = div('', body, {
        background: 'linear-gradient(150deg, #4a4540 0%, #24211e 22%, #121110 50%, #1f1c1a 78%, #3b3733 100%)',
      });
      bezel = div('', rim, { background: '#050505' });
      screen = div('', bezel, { overflow: 'hidden', background: '#141414' });
      screen.id = id;
      div('', rim, { inset: '0', borderRadius: 'inherit', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)', pointerEvents: 'none' });
    },
    seek(T) {
      const b = box(T);
      const op = b.st.opacity ?? 1;
      if (op <= 0.001) {
        body.style.display = 'none';
        return;
      }
      body.style.display = 'block';
      const s = b.s;
      const ow = b.sw + 2 * BZ * s;
      const oh = b.sh + 2 * BZ * s;
      css(body, {
        left: px(b.sx - BZ * s), top: px(b.sy - BZ * s), width: px(ow), height: px(oh),
        opacity: String(clamp01(op)),
        filter: b.st.blur ? `blur(${b.st.blur.toFixed(2)}px)` : 'none',
      });
      css(rim, {
        left: '0', top: '0', width: px(ow), height: px(oh), borderRadius: px(R * s),
        boxShadow: [
          `0 ${px(2 * s)} ${px(4 * s)} rgba(0,0,0,0.35)`,
          `0 ${px(24 * s)} ${px(60 * s)} rgba(0,0,0,0.45)`,
          `0 ${px(60 * s)} ${px(140 * s)} rgba(0,0,0,0.45)`,
        ].join(', '),
      });
      const inset = 3 * s;
      css(bezel, { left: px(inset), top: px(inset), width: px(ow - 2 * inset), height: px(oh - 2 * inset), borderRadius: px((R - 3) * s) });
      css(screen, { left: px(BZ * s - inset), top: px(BZ * s - inset), width: px(b.sw), height: px(b.sh), borderRadius: px((R - BZ) * s) });
      // side buttons: two on the left, one on the right
      const bw = 3.2 * s;
      css(btns[0], { left: px(-bw + 0.6 * s), top: px(150 * s), width: px(bw), height: px(62 * s), borderRadius: px(2 * s) });
      css(btns[1], { left: px(-bw + 0.6 * s), top: px(226 * s), width: px(bw), height: px(62 * s), borderRadius: px(2 * s) });
      css(btns[2], { left: px(ow - 0.6 * s), top: px(196 * s), width: px(bw), height: px(96 * s), borderRadius: px(2 * s) });
    },
  };
}

// ---------------------------------------------------------------- titles

function splitWords(el, text) {
  const words = [];
  const parts = text.split(/(\s+)/);
  for (const p of parts) {
    if (!p) continue;
    const span = document.createElement('span');
    span.className = 'fk-w';
    span.textContent = p;
    el.appendChild(span);
    if (/\S/.test(p)) words.push(span);
  }
  return words;
}

/** Word-by-word reveal of one line: mask sweep + rise + blur-to-sharp. */
function revealLine(lineEl, words, t, { dur = 0.95, stagger = 0.065, rise = 9, blur = 7 } = {}) {
  const sweep = ease.cubicOut(clamp01(t / (dur + stagger * words.length * 0.6)));
  lineEl.style.webkitMaskPosition = `${((1 - sweep) * 100).toFixed(2)}% 0`;
  words.forEach((w, i) => {
    const u = clamp01((t - i * stagger) / dur);
    const e = ease.expoOut(u);
    w.style.transform = `translateY(${((1 - e) * rise).toFixed(3)}px)`;
    w.style.filter = e < 0.999 ? `blur(${((1 - ease.cubicOut(u)) * blur).toFixed(3)}px)` : 'none';
    w.style.opacity = String(clamp01(ease.cubicOut(clamp01(u * 1.6))));
  });
}

/**
 * Chapter card. `eyebrow` like ['01', 'Model'], `line` the chapter line,
 * `sub` optional small print. In at tIn, out at tOut (0.5 s exit).
 * Anchored at (x, y) = top-left of the eyebrow; align 'left' | 'center'.
 * zIndex 5 keeps the card under the window (10) and the phone (20): the edit
 * finishes each exit before the next push-in, and even a late frame can only
 * be covered by the UI, never drawn over it.
 */
export function titleCard({ eyebrow, line, sub, tIn, tOut, x, y, size = 62, align = 'left', subSize = 21, zIndex = 5 }) {
  let root;
  let eb;
  let ln;
  let words;
  let sb;
  let subWords;
  return {
    tIn,
    tOut,
    line,
    mount(stage) {
      injectStyle();
      root = div('fk-title', stage, { left: `${x}px`, top: `${y}px`, zIndex: String(zIndex) });
      if (align === 'center') root.style.transform = 'translateX(-50%)';
      const inner = div('', root, { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start' });
      inner.style.position = 'relative';
      eb = document.createElement('div');
      eb.className = 'fk-eyebrow';
      eb.innerHTML = `<b>${eyebrow[0]}</b><span>—</span><span>${eyebrow[1]}</span>`;
      inner.appendChild(eb);
      ln = document.createElement('div');
      ln.className = 'fk-line';
      css(ln, { fontSize: `${size}px`, marginTop: `${Math.round(size * 0.36)}px`, paddingBottom: '0.12em' });
      words = splitWords(ln, line);
      inner.appendChild(ln);
      if (sub) {
        sb = document.createElement('div');
        sb.className = 'fk-sub fk-line';
        css(sb, { fontSize: `${subSize}px`, marginTop: `${Math.round(size * 0.2)}px`, fontWeight: '450', letterSpacing: '-0.005em', color: '#A39E96' });
        subWords = splitWords(sb, sub);
        inner.appendChild(sb);
      }
    },
    seek(T) {
      if (T < tIn - 0.01 || T > tOut + 0.6) {
        root.style.display = 'none';
        return;
      }
      root.style.display = 'block';
      const e = ease.cubicOut(clamp01((T - tIn) / 0.6));
      eb.style.opacity = String(e);
      eb.style.transform = `translateY(${((1 - e) * 6).toFixed(3)}px)`;
      revealLine(ln, words, T - tIn - 0.12);
      if (sb) revealLine(sb, subWords, T - tIn - 0.55, { dur: 0.8, stagger: 0.03, rise: 6, blur: 4 });
      const o = clamp01((T - tOut) / 0.5);
      const oe = ease.cubicIn(o);
      root.style.opacity = String(1 - ease.sineInOut(o));
      root.style.filter = o > 0 ? `blur(${(oe * 5).toFixed(3)}px)` : 'none';
      const base = align === 'center' ? 'translateX(-50%) ' : '';
      root.style.transform = `${base}translateY(${(-oe * 10).toFixed(3)}px)`;
    },
  };
}

// ---------------------------------------------------------------- edge fade

/**
 * Soft falloff into the stage colour on the left or right frame edge, keyed on
 * for close-ups whose crop must cut a line of conversation prose. It only
 * darkens the frame edge (like a vignette); it never covers the region of interest.
 * spans: [{ side: 'left' | 'right', from, to, fade = 0.5, width = 420 }]
 * `rgb` is the colour it falls off into ('r,g,b'; default the stage) and `alpha`
 * its opacity at the edge and at a third of the way in (the UI loops fade into
 * the app's own #141414, fully, so no clipped word shows at the frame edge).
 */
export function edgeFade({ spans, zIndex = 15, rgb = '13,11,9', alpha = [0.92, 0.62] }) {
  const els = [];
  return {
    mount(stage) {
      for (const sp of spans) {
        const dir = sp.side === 'left' ? '90deg' : '270deg';
        const el = div('fk-edge-fade', stage, {
          top: '0', bottom: '0', width: `${sp.width ?? 420}px`, [sp.side]: '0', zIndex: String(zIndex),
          pointerEvents: 'none', display: 'none',
          background: `linear-gradient(${dir}, rgba(${rgb},${alpha[0]}) 0%, rgba(${rgb},${alpha[1]}) 34%, rgba(${rgb},0) 100%)`,
        });
        els.push({ el, sp });
      }
    },
    seek(T) {
      for (const { el, sp } of els) {
        const f = sp.fade ?? 0.5;
        const o = Math.min(ease.sineInOut(clamp01((T - sp.from) / f)), 1 - ease.sineInOut(clamp01((T - sp.to) / f)));
        el.style.display = o > 0.001 ? 'block' : 'none';
        el.style.opacity = String(o);
      }
    },
  };
}

// ---------------------------------------------------------------- speed badge

export function speedBadge({ spans, x = W - 56, y = H - 56, zIndex = 70 }) {
  let el;
  let label;
  return {
    mount(stage) {
      injectStyle();
      el = div('fk-badge', stage, {
        right: `${W - x}px`, bottom: `${H - y}px`, zIndex: String(zIndex),
        font: '500 15px/1 var(--mono)', color: '#EEEAE3', letterSpacing: '0.06em',
        padding: '9px 13px 9px 12px', borderRadius: '999px',
        background: 'rgba(16,14,12,0.78)', boxShadow: 'inset 0 0 0 1px rgba(255,240,220,0.14), 0 6px 20px rgba(0,0,0,0.35)',
        display: 'none', alignItems: 'center', gap: '9px',
      });
      const tri = document.createElement('span');
      tri.innerHTML = '<svg width="16" height="10" viewBox="0 0 16 10"><path d="M0 0 L7 5 L0 10Z M8 0 L15 5 L8 10Z" fill="#83FCA5"/></svg>';
      css(tri, { display: 'inline-flex' });
      el.appendChild(tri);
      label = document.createElement('span');
      el.appendChild(label);
    },
    seek(T) {
      const s = spans.find((sp) => T >= sp.from - 0.3 && T <= sp.to + 0.3);
      if (!s) {
        el.style.display = 'none';
        return;
      }
      const a = ease.cubicOut(clamp01((T - (s.from - 0.3)) / 0.3));
      const b = 1 - ease.cubicIn(clamp01((T - s.to) / 0.3));
      const o = Math.min(a, b);
      el.style.display = 'flex';
      el.style.opacity = String(o);
      el.style.transform = `translateY(${((1 - o) * 6).toFixed(3)}px)`;
      label.textContent = s.label;
    },
  };
}

// ---------------------------------------------------------------- cold open

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

/** The real mark, powered on: eyes, face, visor, brim, crown, antennae; then name + tagline. */
export function coldOpen({ name, tagline, exitAt, mark = { cx: W / 2, cy: 392, size: 250 } }) {
  let root;
  let svg;
  let parts;
  let bloom;
  let nameEl;
  let nameWords;
  let tagEl;
  let tagWords;
  return {
    async mount(stage) {
      injectStyle();
      root = div('fk-cold', stage, { inset: '0', zIndex: '80' });
      bloom = div('', root, {
        width: '900px', height: '420px', left: `${mark.cx - 450}px`, top: `${mark.cy + mark.size * 0.14 - 210}px`,
        background: 'radial-gradient(closest-side, rgba(131,252,165,0.20), rgba(131,252,165,0.06) 50%, rgba(131,252,165,0) 100%)',
      });
      const holder = div('', root, { left: `${mark.cx - mark.size / 2}px`, top: `${mark.cy - mark.size / 2}px`, width: `${mark.size}px`, height: `${mark.size}px` });
      holder.innerHTML = await fetchText('/public/brand/mark.svg');
      svg = holder.querySelector('svg');
      svg.setAttribute('width', String(mark.size));
      svg.setAttribute('height', String(mark.size));
      svg.style.overflow = 'visible';
      svg.querySelector('title')?.remove();
      svg.querySelector('desc')?.remove();
      const paths = svg.querySelectorAll(':scope > path');
      const rects = svg.querySelectorAll(':scope > rect');
      const eyes = svg.querySelector(':scope > g');
      parts = {
        crown: paths[0], band: paths[1], antL: paths[2], antR: paths[3], brim: paths[4],
        under: svg.querySelector(':scope > ellipse'),
        visor: rects[0], face: rects[1], faceTint: rects[2],
        eyes, eyeRects: [...eyes.querySelectorAll('rect')],
      };
      for (const a of [parts.antL, parts.antR]) {
        a.setAttribute('pathLength', '1');
        a.style.strokeDasharray = '1 1';
      }
      for (const el of svg.querySelectorAll('path, rect, ellipse, g')) {
        el.style.transformBox = 'fill-box';
        el.style.transformOrigin = 'center';
      }
      const block = div('', root, { left: '0', right: '0', top: `${mark.cy + mark.size / 2 + 50}px`, display: 'flex', flexDirection: 'column', alignItems: 'center' });
      block.style.position = 'absolute';
      nameEl = document.createElement('div');
      nameEl.className = 'fk-line fk-title';
      css(nameEl, { fontSize: '92px', fontWeight: '640', letterSpacing: '-0.045em', paddingBottom: '0.1em' });
      nameWords = splitWords(nameEl, name);
      block.appendChild(nameEl);
      tagEl = document.createElement('div');
      tagEl.className = 'fk-sub fk-line';
      css(tagEl, { fontSize: '29px', marginTop: '20px', color: '#B3ADA4', letterSpacing: '-0.012em', fontWeight: '470' });
      tagWords = splitWords(tagEl, tagline);
      block.appendChild(tagEl);
    },
    seek(T) {
      if (T > exitAt + 0.7) {
        root.style.display = 'none';
        return;
      }
      root.style.display = 'block';
      const P = parts;
      // Eyes power on: a flicker, then they stretch open.
      const flick = keyframes(
        [
          { at: 0.3, v: 0 },
          { at: 0.38, v: 0.85, ease: 'cubicOut' },
          { at: 0.45, v: 0.2 },
          { at: 0.53, v: 0.95, ease: 'cubicOut' },
          { at: 0.59, v: 0.55 },
          { at: 0.72, v: 1, ease: 'cubicOut' },
        ],
        T,
      );
      const open = ease.expoOut(clamp01((T - 0.35) / 0.7));
      P.eyes.style.opacity = String(flick);
      for (const r of P.eyeRects) r.style.transform = `scaleX(${(0.08 + 0.92 * open).toFixed(4)})`;
      const bl = keyframes(
        [
          { at: 0.35, v: 0 },
          { at: 0.9, v: 1, ease: 'cubicOut' },
          { at: 2.0, v: 0.55, ease: 'sineInOut' },
        ],
        T,
      );
      bloom.style.opacity = String(bl);
      const fade = (el, t0, d, rise = 0, scale0 = 1) => {
        const u = clamp01((T - t0) / d);
        const e = ease.expoOut(u);
        el.style.opacity = String(ease.cubicOut(u));
        el.style.transform = `translateY(${((1 - e) * rise).toFixed(3)}px) scale(${lerp(scale0, 1, e).toFixed(4)})`;
      };
      fade(P.face, 0.62, 0.65);
      fade(P.faceTint, 0.62, 0.65);
      fade(P.visor, 0.85, 0.75, 0, 0.94);
      fade(P.under, 1.0, 0.8, 22);
      fade(P.brim, 1.0, 0.8, 22);
      fade(P.crown, 1.12, 0.85, 34);
      fade(P.band, 1.12, 0.85, 34);
      const draw = ease.cubicInOut(clamp01((T - 1.22) / 0.8));
      for (const a of [P.antL, P.antR]) {
        a.style.strokeDashoffset = String(1 - draw); // grows from the hat out to the tips
        a.style.opacity = String(clamp01((T - 1.22) / 0.12));
      }
      revealLine(nameEl, nameWords, T - 1.72, { dur: 1.0, stagger: 0.09, rise: 10, blur: 8 });
      revealLine(tagEl, tagWords, T - 2.25, { dur: 0.9, stagger: 0.045, rise: 7, blur: 5 });
      const o = clamp01((T - exitAt) / 0.6);
      const oe = ease.cubicIn(o);
      root.style.opacity = String(1 - ease.sineInOut(o));
      root.style.transform = `translateY(${(-oe * 36).toFixed(3)}px) scale(${(1 - 0.03 * oe).toFixed(4)})`;
      root.style.filter = o > 0 ? `blur(${(oe * 8).toFixed(3)}px)` : 'none';
    },
  };
}

// ---------------------------------------------------------------- outro

export function outro({ tIn, lines, cta, version, url }) {
  let root;
  let mascot;
  let glow;
  let l1;
  let l1w;
  let ctaEl;
  let urlEl;
  return {
    mount(stage) {
      injectStyle();
      root = div('fk-outro', stage, { inset: '0', zIndex: '80' });
      glow = div('', root, {
        width: '1100px', height: '800px', left: `${W / 2 - 550}px`, top: '-10px',
        background: 'radial-gradient(closest-side, rgba(242,85,44,0.16), rgba(242,85,44,0.05) 50%, rgba(242,85,44,0) 100%)',
      });
      mascot = document.createElement('img');
      mascot.src = '/public/brand/mascot.webp';
      mascot.alt = '';
      const mh = 380;
      const mw = (mh * 1023) / 1200;
      css(mascot, { position: 'absolute', left: `${W / 2 - mw / 2}px`, top: '150px', width: `${mw}px`, height: `${mh}px` });
      root.appendChild(mascot);
      const block = div('', root, { left: '0', right: '0', top: '590px', display: 'flex', flexDirection: 'column', alignItems: 'center' });
      l1 = document.createElement('div');
      l1.className = 'fk-line fk-title';
      css(l1, { fontSize: '76px', fontWeight: '640', letterSpacing: '-0.042em', paddingBottom: '0.1em' });
      l1w = splitWords(l1, lines);
      block.appendChild(l1);
      ctaEl = document.createElement('div');
      css(ctaEl, {
        marginTop: '42px', display: 'inline-flex', alignItems: 'center', gap: '14px',
        font: '600 25px/1 var(--sans)', letterSpacing: '-0.015em', color: '#fff',
        background: '#F2552C', padding: '19px 30px 19px 26px', borderRadius: '999px',
        boxShadow: '0 10px 40px rgba(242,85,44,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
      });
      ctaEl.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/></svg>' +
        `<span>${cta}</span>` +
        (version ? `<span style="opacity:.62;font-weight:500">·</span><span style="font-weight:500;opacity:.92;font-variant-numeric:tabular-nums">${version}</span>` : '');
      block.appendChild(ctaEl);
      urlEl = document.createElement('div');
      css(urlEl, { marginTop: '26px', font: '500 21px/1 var(--mono)', color: '#A39E96', letterSpacing: '0.02em' });
      urlEl.textContent = url;
      block.appendChild(urlEl);
    },
    seek(T) {
      if (T < tIn - 0.01) {
        root.style.display = 'none';
        return;
      }
      root.style.display = 'block';
      const m = clamp01((T - tIn) / 1.1);
      const me = ease.expoOut(m);
      mascot.style.opacity = String(ease.cubicOut(clamp01(m * 1.4)));
      mascot.style.transform = `translateY(${((1 - me) * 26).toFixed(3)}px) scale(${lerp(0.94, 1, me).toFixed(4)})`;
      mascot.style.filter = m < 1 ? `blur(${((1 - ease.cubicOut(m)) * 10).toFixed(3)}px)` : 'none';
      glow.style.opacity = String(ease.sineInOut(clamp01((T - tIn) / 1.6)) * (0.94 + 0.06 * Math.sin((2 * Math.PI * T) / 21)));
      revealLine(l1, l1w, T - tIn - 0.55, { dur: 1.0, stagger: 0.12, rise: 10, blur: 8 });
      const c = clamp01((T - tIn - 2.1) / 0.8);
      const ce = ease.expoOut(c);
      ctaEl.style.opacity = String(ease.cubicOut(c));
      ctaEl.style.transform = `translateY(${((1 - ce) * 10).toFixed(3)}px) scale(${lerp(0.97, 1, ce).toFixed(4)})`;
      ctaEl.style.filter = c < 1 ? `blur(${((1 - ease.cubicOut(c)) * 5).toFixed(3)}px)` : 'none';
      const u = clamp01((T - tIn - 2.45) / 0.8);
      urlEl.style.opacity = String(ease.cubicOut(u));
      urlEl.style.transform = `translateY(${((1 - ease.expoOut(u)) * 8).toFixed(3)}px)`;
    },
  };
}
