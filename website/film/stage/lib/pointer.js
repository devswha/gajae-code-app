// Synthetic pointer, driven by the capture's events.json (CSS px of the
// capture viewport, source clock). The recording is headless, so no pointer is
// in the pixels; this puts one back exactly where the real input went.
//
// Desktop: a vector macOS arrow travels each logged move on a slightly arced
// Bezier with a minimum-jerk speed profile, arriving on the logged target at the
// logged time, and dips in scale while the button is held.
// Phone: a soft touch indicator appears at each logged tap and releases with a ripple.

import { clamp01, ease, progress, spring } from './easing.js';

export function buildPointerTrack(events) {
  const moves = [];
  const presses = [];
  const taps = [];
  const starts = events.filter((e) => e.type === 'pointer_move_start');
  for (const s of starts) {
    const end = events.find(
      (e) => e.type === 'pointer_move_end' && e.t >= s.t - 1e-6 && e.target === s.target,
    );
    const t1 = end ? end.t : s.t + (s.durationMs ?? 500) / 1000;
    moves.push({ t0: s.t, t1: Math.max(t1, s.t + 0.05), from: s.from, to: s.to, target: s.target });
  }
  moves.sort((a, b) => a.t0 - b.t0);
  for (const d of events.filter((e) => e.type === 'mouse_down')) {
    const up = events.find((e) => e.type === 'mouse_up' && e.t >= d.t);
    presses.push({ t0: d.t, t1: up ? up.t : d.t + 0.1, at: d.at });
  }
  for (const e of events.filter((ev) => ev.type === 'tap')) taps.push({ t: e.t, at: e.at });

  // Arc: bend each path a little, perpendicular to its direction, the way a
  // wrist swings. The bend is a fixed share of the distance so it is deterministic.
  function pathPoint(m, u) {
    const dx = m.to.x - m.from.x;
    const dy = m.to.y - m.from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) return { x: m.to.x, y: m.to.y };
    const bend = Math.min(0.08 * dist, 60) * (dx >= 0 ? 1 : -1);
    const nx = -dy / dist;
    const ny = dx / dist;
    const c1 = { x: m.from.x + dx * 0.3 + nx * bend, y: m.from.y + dy * 0.3 + ny * bend };
    const c2 = { x: m.from.x + dx * 0.75 + nx * bend * 0.45, y: m.from.y + dy * 0.75 + ny * bend * 0.45 };
    const v = 1 - u;
    return {
      x: v * v * v * m.from.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * m.to.x,
      y: v * v * v * m.from.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * m.to.y,
    };
  }

  function position(t) {
    if (moves.length === 0) {
      const p = presses[0]?.at ?? taps[0]?.at;
      return p ? { x: p.x, y: p.y } : null;
    }
    if (t <= moves[0].t0) return { ...moves[0].from };
    let cur = moves[0];
    for (const m of moves) {
      if (m.t0 <= t) cur = m;
      else break;
    }
    if (t >= cur.t1) return { ...cur.to };
    return pathPoint(cur, ease.minJerk(progress(t, cur.t0, cur.t1)));
  }

  /** 0 = released, 1 = fully pressed. Press eases in fast; release is a spring. */
  function pressAmount(t) {
    let amount = 0;
    for (const p of presses) {
      if (t < p.t0) continue;
      const down = ease.expoOut(clamp01((t - p.t0) / 0.07));
      if (t <= p.t1) amount = Math.max(amount, down);
      else {
        const held = ease.expoOut(clamp01((p.t1 - p.t0) / 0.07));
        const rel = 1 - spring(t - p.t1, { stiffness: 420, damping: 22 });
        amount = Math.max(amount, held * rel);
      }
    }
    return amount;
  }

  /**
   * Touch indicator state: {x, y, opacity, scale, ring, ringOpacity} or null.
   * Kept short (gone ~0.2 s after the tap): the UI usually reacts within
   * 0.1 s (a card closes, rows reflow), and a lingering blob would float over
   * whatever moved in underneath it.
   */
  function touch(t) {
    for (const tap of taps) {
      const dt = t - tap.t;
      if (dt < -0.12 || dt > 0.22) continue;
      const appear = ease.cubicOut(clamp01((dt + 0.12) / 0.12));
      const pressed = dt < 0.08 ? 1 : 1 - spring(dt - 0.08, { stiffness: 520, damping: 26 });
      const fade = 1 - ease.cubicOut(clamp01((dt - 0.06) / 0.14));
      const ringU = clamp01((dt - 0.03) / 0.17);
      return {
        x: tap.at.x,
        y: tap.at.y,
        opacity: appear * fade,
        scale: 1 - 0.12 * pressed,
        ring: 1 + 0.6 * ease.cubicOut(ringU),
        ringOpacity: dt < 0.03 ? 0 : 0.5 * (1 - ease.cubicOut(ringU)),
      };
    }
    return null;
  }

  return { moves, presses, taps, position, pressAmount, touch };
}

/**
 * macOS-style arrow, design units = screen points, hotspot at (0,0). Each
 * instance needs its own filter id: a url(#id) that resolves into a hidden
 * (display:none) shot makes Chromium drop the whole path.
 */
export const arrowSvg = (uid) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 19 26" preserveAspectRatio="none">
  <defs>
    <filter id="ptr-shadow-${uid}" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0.9" stdDeviation="0.9" flood-color="#000" flood-opacity="0.42"/>
    </filter>
  </defs>
  <path filter="url(#ptr-shadow-${uid})" d="M0 0 L0 16.6 L3.9 12.9 L6.4 18.7 L9.2 17.5 L6.8 11.9 L12.1 11.9 Z"
    fill="#000" stroke="#fff" stroke-width="1.35" stroke-linejoin="round" paint-order="stroke"/>
</svg>`;
/** Box of ARROW_SVG in points: viewBox origin offset and size. */
export const ARROW_BOX = { ox: -3, oy: -3, w: 19, h: 26 };
