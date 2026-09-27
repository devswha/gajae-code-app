// Feature loop "permission" (UI only, 1600x1000): it opens on the bash
// permission card (frame 0 is the poster), the pointer passes "Always allow
// bash" and presses Allow, the tests run (6 OK) and the turn folds to "Worked
// for 28s" with its summary (C3). A short dip through the app background (not a
// dissolve, which laid the card over the summary text) returns to the card.
// The pointer is hidden on frame 0 (the poster), fades in at rest before it moves
// and fades out once it rests again, so no still shows an arrow parked in space.

import { loopTailDip } from '/stage/lib/compose.js';
import { edgeFade } from '/stage/lib/film.js';

const DURATION = 9.0;
const DIP = 0.12;

export default async function featurePermission({ reel }) {
  const p1 = await reel(['C2-live-turn', 'C3-permission']);
  const c3 = (t) => p1.at('C3-permission', t);
  const time = [
    [-0.5, c3(0.3)], // the card is already up as the loop fades back in
    [0, c3(0.45)], // card up, pointer at rest
    [0.9, c3(1.75)],
    [1.9, c3(2.85)], // pointer passes "Always allow bash"
    [2.7, c3(4.5)], // on to Allow, hover
    [3.5, c3(5.471), 1], // press Allow
    [4.2, c3(6.3)], // card closes, the command runs
    [5.5, c3(9.8)], // the model reads the output (sped up)
    [6.1, c3(10.45)], // block folds: "Worked for 28s · …" and the summary
    [DURATION, c3(12.9)], // held on the summary, about real time
  ];
  // CARD: the whole card (its content, with the card border just outside both
  // edges), the edit and bash rows above it and the composer below.
  // RESULT: the fold row and the summary's first paragraphs at ~1.9 output px per
  // CSS px; the long bullet lines run off the right edge under a soft fade.
  const CARD = { x: 348, y: 250, w: 1040 };
  const RESULT = { x: 330, y: 136, w: 880 };
  const camera = [
    { at: 0, ...CARD },
    { at: 3.9, ...CARD },
    { at: 5.1, ...RESULT, ease: 'cubicInOut' },
  ];
  const main = {
    id: 'main', reel: p1, time, camera, pointer: 'arrow',
    pointerOpacity: [
      { at: 0.35, v: 0 },
      { at: 0.75, v: 1, ease: 'sineInOut' }, // moves at about 1.2
      { at: 5.6, v: 1 },
      { at: 6.0, v: 0, ease: 'sineInOut' }, // at rest after Allow (c3 7.7)
    ],
  };
  return {
    id: 'feature-permission', width: 1600, height: 1000, fps: 60, duration: DURATION, supersample: 4,
    layers: [
      edgeFade({
        spans: [{ side: 'right', from: 4.3, to: DURATION - 0.55, width: 150, fade: 0.3 }], // gone before the dip
        rgb: '20,20,20', alpha: [1, 0.85], zIndex: 200,
      }),
    ],
    background: '#141414',
    shots: [main, loopTailDip(main, { duration: DURATION, dip: DIP })],
  };
}
