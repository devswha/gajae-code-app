// Easing and motion primitives. Every function here is pure: the same input
// always gives the same output, so a frame rendered twice is identical.

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x) => clamp(x, 0, 1);
export const lerp = (a, b, u) => a + (b - a) * u;

/** Progress of `t` through [t0, t1], clamped to 0..1. */
export const progress = (t, t0, t1) => (t1 <= t0 ? (t >= t1 ? 1 : 0) : clamp01((t - t0) / (t1 - t0)));

export const ease = {
  linear: (u) => u,
  sineInOut: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  cubicIn: (u) => u * u * u,
  cubicOut: (u) => 1 - (1 - u) ** 3,
  cubicInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  quartOut: (u) => 1 - (1 - u) ** 4,
  quintInOut: (u) => (u < 0.5 ? 16 * u ** 5 : 1 - (-2 * u + 2) ** 5 / 2),
  expoOut: (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u)),
  expoIn: (u) => (u <= 0 ? 0 : 2 ** (10 * u - 10)),
  expoInOut: (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2,
  /** Minimum-jerk profile (10u^3 - 15u^4 + 6u^5): how a hand moves a mouse. */
  minJerk: (u) => u * u * u * (10 + u * (-15 + 6 * u)),
};

export function easeFn(name) {
  if (typeof name === 'function') return name;
  const fn = ease[name ?? 'cubicInOut'];
  if (!fn) throw new Error(`unknown easing "${name}"`);
  return fn;
}

/**
 * Closed-form damped spring from 0 to 1 (mass-spring-damper, x(0)=0, x'(0)=velocity).
 * `t` is seconds since release. Under-, critically and over-damped cases are all analytic.
 */
export function spring(t, { stiffness = 170, damping = 26, mass = 1, velocity = 0 } = {}) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  // y = x - 1, y(0) = -1, y'(0) = velocity
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = -1;
    const b = (velocity + zeta * w0 * a) / wd;
    return 1 + Math.exp(-zeta * w0 * t) * (a * Math.cos(wd * t) + b * Math.sin(wd * t));
  }
  if (zeta === 1) {
    // y = (a + b t) e^(-w0 t), a = -1, b = velocity + w0 * a
    return 1 + (-1 + (velocity - w0) * t) * Math.exp(-w0 * t);
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  const c2 = (velocity + r1) / (r2 - r1);
  const c1 = -1 - c2;
  return 1 + c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
}

/**
 * Piecewise keyframed scalar: [{at, v, ease?}] sorted by `at`. The `ease` on a
 * keyframe shapes the segment that arrives at it. Clamped outside the range.
 */
export function keyframes(list, t) {
  if (!list || list.length === 0) return undefined;
  if (t <= list[0].at) return list[0].v;
  for (let i = 1; i < list.length; i += 1) {
    const k = list[i];
    if (t <= k.at) {
      const p = list[i - 1];
      return lerp(p.v, k.v, easeFn(k.ease)(progress(t, p.at, k.at)));
    }
  }
  return list[list.length - 1].v;
}
