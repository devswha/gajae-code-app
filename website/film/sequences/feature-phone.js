// Feature loop "phone" (UI only, 780x1688): the same live session in the web UI
// on a phone: the permission card, a tap on Allow, the tests run and turn 2
// finishes with the sorted output (C6-mobile). Touch indicator on the tap.

import { loopTail } from '/stage/lib/compose.js';

const DURATION = 7.0;
const XFADE = 0.8;

export default async function featurePhone({ reel }) {
  const ph = await reel(['C6-mobile']);
  const m = (t) => ph.at('C6-mobile', t);
  const time = [
    [-XFADE, m(20.4)],
    [0, m(21.1)], // card on screen
    [1.5, m(24.26), 1], // tap Allow
    [2.2, m(24.9)], // card closes, tests run
    [3.5, m(27.45)], // waiting -> thinking (sped up)
    [3.7, m(27.8)], // turn 2 finished: sorted output, 7 tests pass
    [DURATION, m(30.7)],
  ];
  const camera = [{ at: 0, x: 0, y: 0, w: 390 }];
  // For ~0.26 s before the finished turn settles, the phone paints the new
  // summary under a stale "Worked for 3m 22s" label; hold over that transient.
  const skip = [[m(27.495), m(27.759)]];
  const main = { id: 'main', reel: ph, time, camera, skip, pointer: 'touch' };
  return {
    id: 'feature-phone', width: 780, height: 1688, fps: 60, duration: DURATION, supersample: 2,
    shots: [main, loopTail(main, { duration: DURATION, crossfade: XFADE })],
  };
}
