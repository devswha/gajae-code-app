// Feature loop "worktree" (UI only, 1600x1000): the agent sidebar's Environment
// panel: Changes 4, the session's worktree directory and its job branch (C8).
//
// Frame 0 (the poster) is the panel just opened, the pointer still resting on the
// "Show agent sidebar" button it pressed. The panel holds while the pointer moves
// off, for most of the loop. A short dip through the app background (never a
// dissolve: opening the sidebar reflows the conversation, so a dissolve would lay
// two copies of the prose over each other) returns to the closed state with the
// pointer on its way to the button; it presses it and the panel opens, which is
// frame 0 again (continuous footage at the seam).

import { fadeIn, fadeOut } from '/stage/lib/compose.js';
import { edgeFade } from '/stage/lib/film.js';

const DURATION = 7.0;
const DIP = 0.12;
const BACK = 4.4; // the open panel is on screen for T 0-4.5 and again from about 5.7

// The tightest crop the source allows (800 CSS px = 1600 source px, 1:1), flush
// with the window's right edge: the header's panel toggle and the whole agent
// sidebar (x 1115-1440), so the panel reads at 1.05x on the page's 840-px stage.
// The conversation beside it runs off the left edge under a soft fade.
const CAM = [{ at: 0, x: 640, y: 0, w: 800 }];

export default async function featureWorktree({ reel }) {
  const p2 = await reel(['C6-desktop-mirror', 'C8-agent-sidebar']);
  const c8 = (t) => p2.at('C8-agent-sidebar', t);
  const SEAM = c8(2.9); // panel open and settled, pointer still on the toggle

  const open = {
    id: 'open',
    reel: p2,
    end: BACK + DIP + 0.01,
    opacity: fadeOut(BACK, DIP),
    time: [
      [-0.5, c8(2.4)],
      [0, SEAM, 1],
      [0.5, c8(3.4)], // pointer moves off to rest
      [1.6, c8(4.6)],
      [BACK + DIP + 0.1, c8(6.2)], // hold, pointer at rest
    ],
    camera: CAM,
    pointer: 'arrow',
  };

  const reveal = {
    id: 'reveal',
    reel: p2,
    start: BACK + DIP,
    zIndex: 10,
    opacity: fadeIn(BACK + DIP, DIP),
    time: [
      [BACK + DIP, c8(0.62)], // panel closed, the pointer on its way to the button
      [5.4, c8(1.427), 1], // press "Show agent sidebar"
      [DURATION, SEAM, 1], // the panel is open: frame 0 again
    ],
    camera: CAM,
    pointer: 'arrow',
  };

  return {
    id: 'feature-worktree', width: 1600, height: 1000, fps: 60, duration: DURATION, supersample: 4,
    background: '#141414',
    layers: [
      edgeFade({
        spans: [{ side: 'left', from: -10, to: DURATION + 10, width: 260 }],
        rgb: '20,20,20', alpha: [1, 0.85], zIndex: 200,
      }),
    ],
    shots: [open, reveal],
  };
}
