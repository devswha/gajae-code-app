// Feature loop "states" (UI only, 1600x1000): the sidebar while turn 2 runs.
// tidepool shows its running spinner; then the turn asks for a bash permission
// and tidepool flips to "waiting for your input" (a real state change: the
// Work count goes to 2 and the row moves up by priority), next to pixel-press,
// which was already waiting (C7 -> C2b -> C6-desktop-mirror, real time).
// No pointer: the real one had left the rows, so no hover toolbar covers a title.

import { loopTailDip } from '/stage/lib/compose.js';
import { edgeFade } from '/stage/lib/film.js';

const DURATION = 7.5;
const DIP = 0.12; // a dip, not a dissolve: the rows reorder, so a dissolve doubles them

export default async function featureStates({ reel }) {
  const p2 = await reel(['C4-review-reply', 'C7-sidebar', 'C2b-live-turn-2', 'C6-desktop-mirror']);
  const c7 = (t) => p2.at('C7-sidebar', t);
  const time = [
    [-0.5, c7(13.6)],
    [0, c7(14.1)], // tidepool running, pixel-press waiting
    [3.9, c7(18.0)], // the card appears: tidepool -> waiting for your input
    [DURATION, c7(21.6)],
  ];
  // 940 CSS px wide (0.89x on the page's 840-px stage, in line with the other
  // chapters): project list and Work section; the footer's quota rings (y 790+) stay out.
  const camera = [{ at: 0, x: 0, y: 150, w: 940 }];
  const main = { id: 'main', reel: p2, time, camera, pointer: null };
  return {
    id: 'feature-states', width: 1600, height: 1000, fps: 60, duration: DURATION, supersample: 4,
    // The crop has to run through the conversation column; fade that prose into
    // the app's own background so no clipped sentence sits on the edge.
    layers: [
      edgeFade({
        spans: [{ side: 'right', from: -10, to: DURATION + 10, width: 940 }],
        rgb: '20,20,20', alpha: [1, 0.86], zIndex: 200,
      }),
    ],
    background: '#141414',
    shots: [main, loopTailDip(main, { duration: DURATION, dip: DIP })],
  };
}
