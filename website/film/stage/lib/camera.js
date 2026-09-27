// Virtual camera over a footage frame. A key is {at, x, y, w, ease?}: the
// region of the capture viewport (CSS px) that fills the output at timeline
// second `at`; its height follows from the output aspect. Between keys the
// centre moves on the eased parameter and the zoom interpolates in log space,
// so a push-in has constant perceived speed. `ease` on a key shapes the move
// that arrives at it (default cubicInOut).

import { clamp, easeFn, lerp, progress } from './easing.js';

export function createCamera(keys, { viewport, dpr, outW, outH, minSourcePxPerOutPx = 1 }) {
  if (!keys || keys.length === 0) keys = [{ at: 0, x: 0, y: 0, w: viewport.width }];
  const aspect = outH / outW;
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  for (const k of sorted) {
    const h = k.w * aspect;
    if (k.w * dpr < outW * minSourcePxPerOutPx - 1e-6) {
      throw new Error(
        `camera key at ${k.at}s zooms past native resolution: ${k.w}css*${dpr} = ${k.w * dpr}px < ${outW}px output`,
      );
    }
    if (k.x < -1e-6 || k.y < -1e-6 || k.x + k.w > viewport.width + 1e-6 || k.y + h > viewport.height + 1e-6) {
      throw new Error(
        `camera key at ${k.at}s leaves the frame: x=${k.x} y=${k.y} w=${k.w} h=${h.toFixed(1)} in ${viewport.width}x${viewport.height}`,
      );
    }
  }

  function rectAt(t) {
    let k0 = sorted[0];
    let k1 = sorted[0];
    let u = 0;
    if (t <= sorted[0].at) {
      k0 = k1 = sorted[0];
    } else if (t >= sorted[sorted.length - 1].at) {
      k0 = k1 = sorted[sorted.length - 1];
    } else {
      for (let i = 1; i < sorted.length; i += 1) {
        if (t <= sorted[i].at) {
          k0 = sorted[i - 1];
          k1 = sorted[i];
          u = easeFn(k1.ease)(progress(t, k0.at, k1.at));
          break;
        }
      }
    }
    const w = k0.w === k1.w ? k0.w : Math.exp(lerp(Math.log(k0.w), Math.log(k1.w), u));
    const cx = lerp(k0.x + k0.w / 2, k1.x + k1.w / 2, u);
    const cy = lerp(k0.y + (k0.w * aspect) / 2, k1.y + (k1.w * aspect) / 2, u);
    const h = w * aspect;
    const x = clamp(cx - w / 2, 0, viewport.width - w);
    const y = clamp(cy - h / 2, 0, viewport.height - h);
    return { x, y, w, h, scale: outW / w }; // scale: output px per CSS px
  }

  return { rectAt, keys: sorted };
}
