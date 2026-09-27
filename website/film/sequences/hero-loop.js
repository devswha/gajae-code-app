// Hero loop (UI only): the whole app window, sidebar included (the full 1440x900
// CSS viewport, 2880x1800 source downscaled to 1920x1200; the camera never moves).
//
// It opens on the permission card (frame 0 doubles as the poster and the
// reduced-motion image): the pointer goes to Allow, the tests run, the turn folds
// to "Worked for 28s" with its summary. Then it dips through the app background
// (a 0.12 s fade down and up; a dissolve laid the composer over the summary text)
// back to the start of the same session: the prompt typed in the new-conversation composer (about
// 1.9x), Send, the live turn sped up while it thinks, the work block filling,
// and it arrives at the permission card again. The loop point is one real
// moment (end of C2 = start of C3), so the seam is continuous footage, not a
// dissolve. The pointer is hidden on frame 0 (the poster) and fades in at rest
// before its first move; it fades out again once it rests near the loop's end. Footage: p1-desktop (C1-compose, C2-live-turn, C3-permission).

import { fadeIn, fadeOut } from '/stage/lib/compose.js';

export const DURATION = 19.0;
const BACK = 8.2; // dip from the finished turn back to the empty composer
const DIP = 0.12;

// The whole capture viewport, 16:10 like the output: 0.75 output px per CSS px x 2 dpr.
const FULL = { at: 0, x: 0, y: 0, w: 1440 };

export default async function heroLoop({ reel }) {
  const p1 = await reel(['C1-compose', 'C2-live-turn', 'C3-permission']);
  const c1 = (t) => p1.at('C1-compose', t);
  const c2 = (t) => p1.at('C2-live-turn', t);
  const c3 = (t) => p1.at('C3-permission', t);

  const SEAM = c3(0.45); // the card is on screen, the pointer at rest; both shots meet here

  // Shot A: permission card -> Allow -> tests pass -> the turn folds.
  const decide = {
    id: 'decide',
    reel: p1,
    time: [
      [-0.5, c3(-0.05)],
      [0, SEAM, 1], // loop start: card up (C3 starts the moment it appears)
      [1.0, c3(1.75)],
      [2.0, c3(2.85)], // pointer passes "Always allow bash"
      [2.8, c3(4.5)], // on to Allow, hover
      [3.6, c3(5.471), 1], // press Allow (real time around the click)
      [4.3, c3(6.3)], // card closes, the command runs (6 tests OK)
      [5.6, c3(9.9)], // the model reads the output (sped up)
      [6.2, c3(10.5)], // block folds: "Worked for 28s · 5 files read · …" + summary
      [BACK, c3(12.4)], // hold on the finished turn (real time)
      [BACK + DIP + 0.1, c3(12.6)],
    ],
    end: BACK + DIP + 0.01,
    opacity: fadeOut(BACK, DIP),
    camera: [FULL],
    pointer: 'arrow',
    pointerOpacity: [
      { at: 0.3, v: 0 },
      { at: 0.7, v: 1, ease: 'sineInOut' }, // its first move starts at about 1.1
    ],
  };

  // Shot B: compose -> Send -> the live turn -> the card appears (= frame 0).
  const run = {
    id: 'run',
    reel: p1,
    start: BACK + DIP,
    zIndex: 10,
    opacity: fadeIn(BACK + DIP, DIP),
    time: [
      [BACK + DIP, c1(2.3)], // composer focused, pointer on it
      [BACK + 0.8, c1(2.9)], // typing starts
      [13.4, c1(11.473)], // prompt typed (~1.9x)
      [13.8, c1(12.76)],
      [14.7, c1(13.915)], // pointer to Send
      [14.9, c1(14.139), 1], // press Send
      [15.2, c1(14.5)],
      [15.6, c2(12.2)], // ~15 s of "Thinking…" in 0.4 s: straight to the first reads
      [16.1, c2(13.31), 1.2], // pointer opens the work block
      [17.0, c2(16.3)], // Read x4, Search, Read fill in
      [18.2, c2(24.4)], // thinking (about 7x); edit x3 lands
      [DURATION, SEAM, 1], // the permission card appears: frame 0 again
    ],
    camera: [FULL],
    // The live edit card is painted expanded for ~40 ms before it folds into
    // "edit x3"; sped up that is a one-frame flash, so hold over it.
    // (the end reaches the next clean frame at 23.8911, so no time lands on the flash)
    skip: [[c2(23.85), c2(23.895)]],
    pointer: 'arrow',
    // at rest after opening the work block (c2 16.4, T about 17.0); gone by frame 0
    pointerOpacity: [
      { at: 18.2, v: 1 },
      { at: 18.6, v: 0, ease: 'sineInOut' },
    ],
  };

  return {
    id: 'hero-loop',
    width: 1920,
    height: 1200,
    fps: 60,
    duration: DURATION,
    supersample: 4,
    background: '#141414',
    shots: [decide, run],
  };
}
