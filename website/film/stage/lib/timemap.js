// Timeline time -> footage time, as a monotone cubic Hermite curve through anchors.
//
// Anchors are [T, t] or [T, t, speed]: at timeline second T the footage is at
// source second t. Between anchors the playback speed (dt/dT) changes smoothly
// (C1), so a speed ramp never jumps. Anchors hit exactly, which is how a logged
// click stays frame-accurate while the wait around it is sped up. A third value
// pins the speed at that anchor (1 = real time); otherwise Fritsch-Carlson picks
// a tangent that keeps the curve monotone (no footage running backwards).
// Outside the anchors the curve continues linearly at the end speed.

export function createTimemap(anchors) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new Error('timemap needs at least two anchors');
  }
  const T = anchors.map((a) => a[0]);
  const x = anchors.map((a) => a[1]);
  const n = anchors.length;
  for (let i = 1; i < n; i += 1) {
    if (!(T[i] > T[i - 1])) throw new Error(`timemap anchors must increase in T (at ${T[i]})`);
    if (x[i] < x[i - 1]) throw new Error(`timemap anchors must not run footage backwards (at T=${T[i]})`);
  }
  const d = []; // secant slopes
  for (let i = 0; i < n - 1; i += 1) d.push((x[i + 1] - x[i]) / (T[i + 1] - T[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) m[i] = 0;
    else {
      // weighted harmonic mean (Fritsch-Butland), monotone by construction
      const h0 = T[i] - T[i - 1];
      const h1 = T[i + 1] - T[i];
      const w1 = 2 * h1 + h0;
      const w2 = h1 + 2 * h0;
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  for (let i = 0; i < n; i += 1) if (anchors[i].length > 2 && anchors[i][2] != null) m[i] = anchors[i][2];

  function map(t) {
    if (t <= T[0]) return x[0] + m[0] * (t - T[0]);
    if (t >= T[n - 1]) return x[n - 1] + m[n - 1] * (t - T[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (T[mid] <= t) lo = mid;
      else hi = mid;
    }
    const h = T[hi] - T[lo];
    const s = (t - T[lo]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * x[lo] +
      (s3 - 2 * s2 + s) * h * m[lo] +
      (-2 * s3 + 3 * s2) * x[hi] +
      (s3 - s2) * h * m[hi]
    );
  }
  // A pinned speed can make a segment overshoot; refuse curves that run backwards.
  for (let i = 0; i < n - 1; i += 1) {
    let prev = x[i];
    for (let k = 1; k <= 64; k += 1) {
      const v = map(T[i] + ((T[i + 1] - T[i]) * k) / 64);
      if (v < prev - 1e-6) {
        throw new Error(`timemap runs backwards between T=${T[i]} and T=${T[i + 1]}; relax a pinned speed`);
      }
      prev = v;
    }
  }
  map.speedAt = (t) => (map(t + 1e-3) - map(t - 1e-3)) / 2e-3;
  map.anchors = anchors;
  return map;
}
