// Helpers for assembling sequences out of shots.

/**
 * Seamless loop: a copy of `first` that fades in over the last `crossfade`
 * seconds, running `duration` seconds late. At T = duration it shows exactly
 * what `first` shows at T = 0, so the video's last frame dissolves into its first.
 * `first.time` must cover T in [-crossfade, 0] (anchors extrapolate linearly).
 *
 * Only one pointer may show through the dissolve: the outgoing shot's pointer
 * fades out in the first 0.15 s (see fadeOutPointer), and the incoming copy's
 * pointer comes up with its shot. If another shot is the one on screen at the
 * loop's end, call fadeOutPointer on that shot as well.
 */
export function loopTail(first, { duration, crossfade = 0.8, ease = 'sineInOut' }) {
  const tail = {
    ...first,
    id: `${first.id}-loop`,
    offset: duration,
    start: duration - crossfade,
    end: Infinity,
    zIndex: 100,
    pointerOpacity: undefined,
    opacity: [
      { at: duration - crossfade, v: 0 },
      { at: duration, v: 1, ease },
    ],
  };
  fadeOutPointer(first, duration - crossfade);
  return tail;
}

/** Fade a shot's pointer to 0 over `dur` seconds from timeline second `at` (1 before). */
export function fadeOutPointer(shot, at, dur = 0.15) {
  if (!shot.pointer || shot.pointerOpacity) return shot;
  shot.pointerOpacity = [
    { at, v: 1 },
    { at: at + dur, v: 0, ease: 'cubicOut' },
  ];
  return shot;
}

/** Opacity keys for a dissolve into a shot: 0 at `at`, 1 at `at + dur`. */
export const fadeIn = (at, dur, ease = 'sineInOut') => [
  { at, v: 0 },
  { at: at + dur, v: 1, ease },
];

/** Cubic-in-out camera key helper that fits a region to the output aspect, centred on (cx, cy). */
export function frameOn(at, cx, cy, w, aspect, ease) {
  const h = w * aspect;
  return { at, x: cx - w / 2, y: cy - h / 2, w, ease };
}

/**
 * Dip-through-background keys for the outgoing shot: full until `at`, gone at `at + dur`.
 * Pair with fadeIn(at + dur, dur) on the incoming shot. Used instead of a dissolve
 * between two text-heavy UI states, where a cross-dissolve reads as a double exposure.
 */
export const fadeOut = (at, dur, ease = 'sineInOut') => [
  { at, v: 1 },
  { at: at + dur, v: 0, ease },
];

/**
 * Seamless loop through a short dip instead of a dissolve: the shot on screen at the
 * end fades to the stage background over `dip` s, then a copy of `first` (running
 * `duration` s late, so at T = duration it shows first's frame 0) fades up over `dip` s.
 * `last` is the shot on screen at the loop's end (defaults to `first`).
 */
export function loopTailDip(first, { duration, dip = 0.12, last = first }) {
  const tail = {
    ...first,
    id: `${first.id}-loop`,
    offset: duration,
    start: duration - dip,
    end: Infinity,
    zIndex: 100,
    // Pointer opacity keys are on the global timeline; near T = duration they are the
    // ones the loop ends on, which is what frame 0 shows.
    pointerOpacity: first.pointerOpacity,
    opacity: fadeIn(duration - dip, dip),
  };
  const out = fadeOut(duration - 2 * dip, dip);
  last.opacity = last.opacity ? [...last.opacity.filter((k) => k.at < duration - 2 * dip), ...out] : out;
  return tail;
}
