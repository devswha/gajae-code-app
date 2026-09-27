// Feature loop "review" (UI only, 1600x1000): read the cli.py diff inline in the
// conversation (C4a retake; frame 0 is the poster), then dissolve straight to the
// composer of the real take (C4), where the reply is typed and sent and turn 2
// starts. The two framings dissolve into each other, so C4's README.md diff is
// never on screen.

import { loopTail, fadeIn, fadeOutPointer } from '/stage/lib/compose.js';

const DURATION = 10.0;
const XFADE = 0.8;
const CUT = 2.6; // dissolve C4a -> C4
const CUT_DUR = 0.6;

// DIFF: the "edit / cli.py +17 −0" header and the added lines through the
// payload's "for tide in tides"; the floating scroll-to-bottom button (real UI,
// over the print(...) line) stays below the bottom edge.
const DIFF = { x: 376, y: 67, w: 1016 };
// COMPOSER: the composer (typed reply to Send), the agent's summary above it and
// its bash row at the top; the README.md diff further up stays out.
const COMPOSER = { x: 348, y: 236, w: 1040 };

export default async function featureReview({ reel }) {
  const p3 = await reel(['C4a-review-diff']);
  const p2 = await reel(['C4-review-reply', 'C7-sidebar']);
  const a = (t) => p3.at('C4a-review-diff', t);
  const b = (t) => p2.at('C4-review-reply', t);

  const diff = {
    id: 'diff',
    reel: p3,
    end: CUT + CUT_DUR,
    time: [
      [-XFADE, a(9.6)],
      [0, a(10.45)], // cli.py diff in view (+17): the --json payload
      [CUT + CUT_DUR, a(13.2)], // pointer traces the added block
    ],
    camera: [{ at: 0, ...DIFF }],
    pointer: 'arrow',
  };
  fadeOutPointer(diff, CUT - 0.15);

  const reply = {
    id: 'reply',
    reel: p2,
    start: CUT,
    opacity: fadeIn(CUT, CUT_DUR),
    zIndex: 10,
    time: [
      [CUT, b(18.0)], // pointer on the composer
      [CUT + 0.3, b(18.2)], // click
      [CUT + 0.55, b(18.59), 1.2], // typing starts
      [6.6, b(23.29), 1.25], // reply typed at a natural pace
      [7.0, b(24.49)],
      [7.95, b(26.03)], // to Send
      [8.2, b(26.29), 1], // press Send
      [DURATION, b(27.9)], // turn 2 starts: the reply bubble, "Thinking…"
    ],
    camera: [{ at: CUT, ...COMPOSER }],
    pointer: 'arrow',
  };
  // the reply shot is the one on screen at the loop's end: only one pointer through the seam
  fadeOutPointer(reply, DURATION - XFADE);
  return {
    id: 'feature-review', width: 1600, height: 1000, fps: 60, duration: DURATION, supersample: 4,
    shots: [diff, reply, loopTail(diff, { duration: DURATION, crossfade: XFADE })],
  };
}
