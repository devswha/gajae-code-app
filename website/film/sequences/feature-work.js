// Feature loop "work" (UI only, 1600x1000): one turn's work block, from the rows
// filling to the fold into its one-line summary (C2 -> C3, sped up).
//
// Frame 0 (the poster and the reduced-motion image) is the finished turn: the
// prompt, the folded row "Worked for 28s · 5 files read · 1 search · 1 command ·
// 3 edits" and the first paragraphs of the result, so the frame is full and the
// page's readout matches the footage. It holds, dips to the app background and
// comes back on the open block while Read x4, Search and Read fill in and the
// three edits land. A second dip skips the permission card (chapter 02's subject)
// and picks up after Allow, with the bash row done and the model reading its
// output; the block then folds, which is frame 0's source time again (continuous footage at the seam).
//
// No pointer: the segments start after the work-block click and after Allow, so
// no click happens on screen, and a parked arrow would only hide status text.

import { fadeIn, fadeOut } from '/stage/lib/compose.js';

const DURATION = 8.0;
const DIP = 0.12; // each half of a dip through the app background
const HOLD = 2.2; // the finished turn, held
const CUT2 = 6.1; // edits landed -> bash row running

// The conversation column at about 1:1 source px, top-anchored so the block grows
// down: the prompt bubble and every row whole (x 350-1390, y 54-704).
const CAM = [{ at: 0, x: 350, y: 54, w: 1040 }];

export default async function featureWork({ reel }) {
  const p1 = await reel(['C1-compose', 'C2-live-turn', 'C3-permission']);
  const c2 = (t) => p1.at('C2-live-turn', t);
  const c3 = (t) => p1.at('C3-permission', t);
  const SEAM = c3(10.62); // folded; the result has rendered below it
  // 40 ms flash of the live edit card (frames at 23.855 and 23.873); the end must
  // reach the next clean frame (23.8911), or a time just before it still shows 23.873.
  const skip = [[c2(23.85), c2(23.895)]];

  const done = {
    id: 'done',
    reel: p1,
    end: HOLD + DIP + 0.01,
    opacity: fadeOut(HOLD, DIP),
    time: [
      [-0.5, c3(10.1)],
      [0, SEAM, 1],
      [HOLD + DIP + 0.05, c3(12.7)],
    ],
    camera: CAM,
  };

  const fill = {
    id: 'fill',
    reel: p1,
    start: HOLD + DIP,
    end: CUT2 + DIP + 0.01,
    zIndex: 10,
    opacity: [...fadeIn(HOLD + DIP, DIP), ...fadeOut(CUT2, DIP)],
    time: [
      [HOLD + DIP, c2(13.62)], // block open (clicked at 13.31), the first reads in
      [3.6, c2(16.4)], // Read x4, Search, Read fill in (about 2x)
      [5.5, c2(24.6)], // thinking, time-lapsed (about 4x); edit x3 lands
      [CUT2 + DIP + 0.05, c2(25.2)], // before the card appears (25.46)
    ],
    camera: CAM,
    skip,
  };

  const run = {
    id: 'run',
    reel: p1,
    start: CUT2 + DIP,
    zIndex: 20,
    opacity: fadeIn(CUT2 + DIP, DIP),
    time: [
      // Allow was pressed at 5.47 and the command has run; the status row now reads
      // "Thinking… · Running python3 -m unittest …" (it still said "Waiting for your
      // approval" in the frames until about 9.95, which would read oddly with the card cut out).
      [CUT2 + DIP, c3(10.0)],
      [DURATION, SEAM, 1], // the block folds at 10.39: frame 0 again
    ],
    camera: CAM,
  };

  return {
    id: 'feature-work', width: 1600, height: 1000, fps: 60, duration: DURATION, supersample: 4,
    background: '#141414', // the app's own background: a dip reads as the UI blinking, not a black flash
    shots: [done, fill, run],
  };
}
