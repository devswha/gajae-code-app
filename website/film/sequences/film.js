// The product film (1920x1080, 60 fps, silent). Real footage of the app running
// real Gajae Code turns, in a macOS window on a warm-dark stage, with a camera,
// chapter type, the pointer from events.json and speed ramps over the waits.
//
//   0  cold open     the mark powers on; name + tagline (held 3 s)
//   1  model         C5 picker: Anthropic Opus 5.5, reasoning High
//   2  prompt        C1 the --json prompt is typed and sent
//   3  live          C2 status row, the work block fills (time-lapsed waits)
//   4  permissions   C3 card -> Allow -> the bash row resolves -> "Worked for 28s"
//   5  review        C4 opens turn 1's edits -> cut on the click to the C4a
//                    cli.py diff (+17) -> cut on the click into C4's composer,
//                    where the reply is typed and sent
//   6  sessions      C7 sidebar: tidepool running, then waiting for input
//   7  phone         C6-mobile beside C6-desktop-mirror, synced on wallMs
//   8  worktree      C8 agent sidebar: Changes, worktree, branch
//   9  outro         mascot, sign-off, download line, URL
//
// Recordings: p1-desktop (C5 C1 C2 C3) and p2-desktop (C4 C7 C2b C6-mirror C8)
// are each one continuous take, so chapters 1-4 and 5b-8 are single shots the
// camera and the time map travel along. C4a is a retake, used only for the
// settled cli.py diff and joined by two hard cuts.
//
// Title rule: every chapter card has fully exited before the next push-in
// starts, and cards sit under the window/phone layers (see titleCard), so type
// is never drawn over live UI.

import { createTimemap } from '/stage/lib/timemap.js';
import { fadeIn } from '/stage/lib/compose.js';
import { keyframes } from '/stage/lib/easing.js';
import {
  backdrop, coldOpen, edgeFade, macWindow, outro, phoneFrame, speedBadge, titleCard, worldCamera,
} from '/stage/lib/film.js';

// ---- camera framings (world = desktop capture CSS px; k = output px per CSS px)
const E = { cx: 720, cy: 337, k: 0.84 }; // establish: whole window, room for a title above
const E2 = { ...E, k: 0.862 }; // the slow creep while a title reads
const TITLE_X = 356; // window's left edge at E
const TITLE_Y = 84;

// Close-ups. x/y ranges in CSS px are noted so the crops stay deliberate:
// the sidebar (x 0-289) is either fully in frame or fully out, never cut.
const WORK = { cx: 880, cy: 290, k: 1.7 }; // x 315-1445, y -28-608: bubble + work block
const ALLOW = { cx: 870, cy: 453.5, k: 1.74 }; // x 318-1422, y 143-764: rows, card; composer (770+) out
const RESULT = { cx: 866, cy: 318, k: 1.7 }; // x 301-1431, y 0-636: bash row, fold, summary
const ROWS = { cx: 866, cy: 376, k: 1.7 }; // x 301-1431, y 58-694: turn 1's rows / the cli.py diff (header in, scroll button out)
const COMPOSER = { cx: 868, cy: 632, k: 1.75 }; // x 320-1417, y 323-941
const SIDEBAR = { cx: 400, cy: 325, k: 2.0 }; // x -80-880, y 55-595: whole sidebar + window edge
const ENV = { cx: 1225, cy: 175, k: 2.0 }; // Environment panel at ~55% of frame width, window edge at ~72%; x 745-1705, y -95-445
const OUT = { cx: 720, cy: 420, k: 0.78 };

// Split screen (chapter 7): the whole desktop window left, the phone right,
// both fully in frame with even margins (window x 102-1340, phone 1410-1818).
const SPLIT = { cx: 997.7, cy: 323.5, k: 0.86 };
const SPLIT_PUSH = { cx: 997.7, cy: 330, k: 0.875 };
const PHONE_S = 0.98; // output px per phone CSS px at SPLIT
const PHONE = { wx: 1535.7, wy: -57.1, ps: PHONE_S / SPLIT.k };

// ---- beats (timeline seconds)
const CO_EXIT = 5.85; // cold open leaves; the tagline has read since ~2.8 s
const T_CUT1 = 44.35 - 1 / 120; // C4 edit-group click -> C4a cli.py diff (between two frames' shutters)
const T_CUT2 = 47.35 - 1 / 120; // C4a -> C4 composer click
const S = 52.0; // Send (turn 2 starts)
const X = S + 7.05; // slide to the split
const Y = X + 8.9; // back to the establishing shot for chapter 8
const FALL = Y + 6.4; // the window falls away
const OUTRO = FALL + 0.8;
export const DURATION = Number((OUTRO + 6.25).toFixed(2));

const key = (at, f, ease = 'cubicInOut') => ({ at, cx: f.cx, cy: f.cy, k: f.k, ease });

export default async function film({ reel }) {
  const p1 = await reel(['C5-model-picker', 'C1-compose', 'C2-live-turn', 'C3-permission']);
  const p3 = await reel(['C4a-review-diff']);
  const p2 = await reel(['C4-review-reply', 'C7-sidebar', 'C2b-live-turn-2', 'C6-desktop-mirror', 'C8-agent-sidebar']);
  const ph = await reel(['C6-mobile']);
  const c5 = (t) => p1.at('C5-model-picker', t);
  const c1 = (t) => p1.at('C1-compose', t);
  const c2 = (t) => p1.at('C2-live-turn', t);
  const c3 = (t) => p1.at('C3-permission', t);
  const c4 = (t) => p2.at('C4-review-reply', t);
  const c7 = (t) => p2.at('C7-sidebar', t);
  const c8 = (t) => p2.at('C8-agent-sidebar', t);
  const m = (t) => ph.at('C6-mobile', t);
  // Phone and desktop were recorded at the same time; both logged the phone's
  // Allow on one wall clock. desktop source = phone source + SYNC.
  const SYNC = p2.find('permission_allowed_on_phone').t - ph.find('permission_allowed_on_phone').t;

  // ---- camera
  const camera = worldCamera([
    key(0, E),
    key(6.3, E),
    // 01 model
    key(9.75, E2, 'sineInOut'),
    key(11.0, { cx: 935, cy: 318, k: 1.85 }), // push: the picker
    key(14.1, { cx: 985, cy: 326, k: 1.9 }, 'sineInOut'), // drift toward Reasoning -> High
    key(15.3, E), // pull back for chapter 2
    // 02 prompt
    key(17.6, E2, 'sineInOut'),
    key(18.85, { cx: 868, cy: 468, k: 1.95 }), // push: the composer
    key(22.25, { cx: 905, cy: 470, k: 1.95 }, 'sineInOut'), // drift toward Send
    key(23.35, E, 'sineInOut'), // Send: the conversation opens, pull back on the click
    // 03 live
    key(25.85, E2, 'sineInOut'),
    key(27.05, WORK), // push: the work block
    key(30.65, { ...WORK, cy: 295, k: 1.72 }, 'sineInOut'),
    key(31.95, E), // the card arrives: pull back
    // 04 permissions
    key(34.0, E2, 'sineInOut'),
    key(35.2, ALLOW), // push: the card and the command row
    key(35.75, { ...ALLOW, cx: 871, cy: 453, k: 1.745 }, 'sineInOut'),
    key(36.95, RESULT), // as the card closes: up to the bash row, then the fold
    key(39.6, { ...RESULT, cy: 321, k: 1.71 }, 'sineInOut'),
    // 05 review
    key(40.8, E),
    key(42.8, E2, 'sineInOut'),
    key(44.0, ROWS), // push: turn 1's rows before the edit group is clicked
    key(T_CUT2 - 0.0002, { ...ROWS, cx: 862 }, 'sineInOut'),
    key(T_CUT2 + 0.0002, COMPOSER), // hard cut into the composer
    key(S - 0.1, { cx: 880, cy: 636, k: 1.77 }, 'sineInOut'),
    // 06 sessions
    key(S + 1.2, E),
    key(S + 3.45, E2, 'sineInOut'),
    key(S + 4.7, SIDEBAR), // push: the sidebar
    key(X, { ...SIDEBAR, cy: 331 }, 'sineInOut'),
    // 07 phone
    key(X + 1.5, SPLIT), // slide over to the split
    key(X + 7.5, SPLIT_PUSH, 'sineInOut'),
    // 08 worktree
    key(Y, E),
    key(Y + 2.05, E2, 'sineInOut'),
    key(Y + 3.25, ENV), // push before the click: the button and the column it opens
    key(FALL, { ...ENV, cx: 1219, cy: 177, k: 1.985 }, 'sineInOut'),
    key(FALL + 1.15, OUT), // pull away for the outro
    key(DURATION, OUT),
  ]);

  // ---- desktop window: rises in after the cold open, falls away for the outro
  const win = macWindow({
    id: 'desk',
    camera,
    state: (T) => {
      const inU = [{ at: CO_EXIT + 0.35, v: 0 }, { at: CO_EXIT + 1.85, v: 1, ease: 'expoOut' }];
      const outU = [{ at: FALL, v: 0 }, { at: FALL + 1.1, v: 1, ease: 'cubicInOut' }];
      const a = 1 - keyframes(inU, T);
      const b = keyframes(outU, T);
      return {
        opacity: Math.min(keyframes([{ at: CO_EXIT + 0.45, v: 0 }, { at: CO_EXIT + 1.25, v: 1, ease: 'cubicOut' }], T), 1 - b),
        dy: 150 * a - 40 * b,
        scale: 1 - 0.05 * a - 0.06 * b,
        blur: 9 * a * a + 7 * b,
      };
    },
  });

  // ---- phone: flies in with the camera, leaves before chapter 8
  const phone = phoneFrame({
    id: 'phone',
    camera,
    ...PHONE,
    state: (T) => {
      const a = 1 - keyframes([{ at: X + 0.2, v: 0 }, { at: X + 1.7, v: 1, ease: 'expoOut' }], T);
      const b = keyframes([{ at: X + 7.5, v: 0 }, { at: X + 8.6, v: 1, ease: 'cubicIn' }], T);
      return {
        opacity: keyframes([{ at: X + 0.2, v: 0 }, { at: X + 0.9, v: 1 }], T) * (1 - b),
        dy: 90 * a + 60 * b,
        dx: 260 * b,
        scale: 1 - 0.04 * a,
        blur: 6 * a * a + 4 * b,
      };
    },
  });

  // ---- shots (time anchors: [timeline s, source s, pinned speed?])
  const sh1 = {
    id: 'p1',
    reel: p1,
    container: 'desk',
    frame: win.frame,
    start: CO_EXIT + 0.35,
    end: 39.65,
    pointer: 'arrow',
    // the live edit card is painted expanded for ~40 ms before it folds
    skip: [[c2(23.85), c2(23.895)]], // ends on the next clean frame (23.8911)
    time: [
      [CO_EXIT + 0.35, c5(0.05)],
      [8.7, c5(1.747), 1], // open the model picker (wide, under the title)
      [10.15, c5(3.6)], // ChatGPT
      [11.95, c5(7.66)], // Anthropic -> Opus 5.5
      [13.15, c5(9.96)], // Reasoning: High
      [14.05, c5(11.446), 1], // select High
      [14.75, c5(12.3)],
      [15.45, c1(0.5)],
      [16.55, c1(2.025), 1], // click the composer
      [20.95, c1(11.473)], // the prompt, typed (about 2x)
      [21.45, c1(12.763)],
      [22.45, c1(14.139), 1], // Send
      [23.05, c1(14.8)],
      [25.65, c2(10.95)], // thinking, time-lapsed
      [26.95, c2(13.31), 1], // open the work block
      [28.25, c2(14.75)], // reads and search fold in
      [29.65, c2(23.55)], // thinking, time-lapsed
      [30.25, c2(24.35)], // edit x3 lands
      [30.95, c2(25.5)], // permission card
      [32.55, c3(1.7)],
      [35.55, c3(5.471), 1], // Allow
      [36.55, c3(6.5)], // card closed; the bash row resolves (Ran 6 tests ... OK)
      [37.65, c3(9.9)], // thinking (about 3x)
      [38.2, c3(10.5)], // folds: Worked for 28s · 5 files read · 1 search · 1 command · 3 edits
      [39.65, c3(12.0)],
    ],
  };
  // The C4a retake, used only for the settled cli.py diff: its first seconds
  // show turn 2's bubble (it was recorded after the real reply), so it is cut
  // in only after its scroll, framed above the floating scroll-to-bottom button.
  const sh3 = {
    id: 'p3',
    reel: p3,
    container: 'desk',
    frame: win.frame,
    start: T_CUT1,
    end: T_CUT2,
    zIndex: 3,
    pointer: 'arrow',
    time: [
      [T_CUT1, 9.6], // scroll landed: edit / cli.py +17 -0, the --json payload
      [45.2, 10.44],
      [46.3, 11.52], // the pointer on "payload = {"
      [T_CUT2, 12.55], // it heads down the added block (toward the composer)
      [48.0, 13.2],
    ],
  };
  const sh2 = {
    id: 'p2',
    reel: p2,
    container: 'desk',
    frame: win.frame,
    start: 39.15,
    end: FALL + 1.15,
    zIndex: 2,
    opacity: fadeIn(39.15, 0.45), // same session, same state as p1's last frame
    pointer: 'arrow',
    pointerOpacity: [
      { at: S + 0.5, v: 1 },
      { at: S + 0.9, v: 0 }, // hidden through the time-lapses and the split
      { at: Y, v: 0 },
      { at: Y + 0.4, v: 1 },
    ],
    time: [
      [39.15, c4(0.95)],
      [40.2, c4(1.2)],
      [41.65, c4(2.861), 1], // open turn 1's work block (wide, under the title)
      [42.9, c4(3.95)],
      [44.2, c4(4.928), 1], // click the edit group: cut on the click to the diff
      [T_CUT2, c4(17.75)], // (under C4a) the pointer arrives on the composer
      [47.7, c4(18.091), 1], // click the composer
      [50.6, c4(23.294)], // the reply, typed (about 1.8x)
      [50.95, c4(24.489)],
      [S, c4(26.29), 1], // Send: turn 2 starts
      [S + 0.6, c4(27.0)],
      [S + 3.15, c7(15.2)], // time-lapse
      [S + 4.45, c7(16.85)],
      [S + 5.65, c7(18.05)], // the turn asks: tidepool flips from running to waiting for input
      [X, c7(19.45)],
      [X + 1.5, m(21.1) + SYNC], // ramp through the wait to the phone moment
      ...phoneTimes().map(([T, t, s]) => (s == null ? [T, t + SYNC] : [T, t + SYNC, s])),
      [Y + 0.3, c8(0.1)],
      [Y + 2.75, c8(0.35)],
      [Y + 3.6, c8(1.427), 1], // Show agent sidebar (in the close-up)
      [FALL, c8(4.2)],
      [FALL + 1.15, c8(5.1)],
    ],
  };
  function phoneTimes() {
    return [
      [X + 3.4, m(24.26), 1], // tap Allow on the phone
      [X + 4.2, m(25.0)], // card closes on both; Ran 7 tests ... OK
      [X + 5.7, m(27.45)],
      [X + 6.1, m(27.9), 1], // turn 2 finished: sorted
      [X + 7.8, m(29.6)],
    ];
  }
  const shPhone = {
    id: 'ph',
    reel: ph,
    container: 'phone',
    frame: phone.frame,
    start: X - 0.1,
    end: X + 8.8,
    pointer: 'touch',
    // stale "Worked for 3m 22s" label painted for ~0.26 s before 39s
    skip: [[m(27.495), m(27.759)]],
    time: [[X - 0.1, m(20.2)], [X + 1.5, m(21.1)], ...phoneTimes(), [X + 8.8, m(30.5)]],
  };

  // ---- type
  const chapters = [
    { n: '01', tag: 'Model', line: 'Pick the model. Set the depth.', tIn: 7.15, tOut: 9.2 },
    { n: '02', tag: 'Prompt', line: 'Say what you want.', tIn: 15.1, tOut: 17.05 },
    { n: '03', tag: 'Live', line: 'Watch the work happen.', tIn: 23.3, tOut: 25.3 },
    { n: '04', tag: 'Permissions', line: 'Commands wait for you.', tIn: 31.5, tOut: 33.45 },
    { n: '05', tag: 'Review', line: 'Read the diff. Reply in the composer.', tIn: 40.4, tOut: 42.25 },
    {
      n: '06', tag: 'Sessions', line: 'Every session, at a glance.', tIn: S + 1.1, tOut: S + 2.9,
      sub: 'Running · Waiting for your input', y: 64,
    },
    {
      n: '07', tag: 'Phone', line: 'Approve from your phone.', tIn: X + 1.35, tOut: X + 7.1,
      sub: 'In the browser: the web UI on your self-hosted server, over your tailnet or VPN.', x: 102, y: 58,
    },
    { n: '08', tag: 'Worktree', line: 'Its own worktree.', tIn: Y - 0.35, tOut: Y + 1.5 },
  ];
  const titles = chapters.map((c) =>
    titleCard({
      eyebrow: [c.n, c.tag], line: c.line, sub: c.sub, tIn: c.tIn, tOut: c.tOut,
      x: c.x ?? TITLE_X, y: c.y ?? TITLE_Y,
    }),
  );

  // time-lapse badges, labelled with the real average speed of the span
  const tm1 = createTimemap(sh1.time);
  const tm2 = createTimemap(sh2.time);
  const avg = (tm, a, b) => `×${Math.round((tm(b) - tm(a)) / (b - a))}`;
  const badges = speedBadge({
    spans: [
      { from: 23.4, to: 25.4, label: avg(tm1, 23.4, 25.4) },
      { from: 28.55, to: 29.5, label: avg(tm1, 28.55, 29.5) },
      { from: S + 0.95, to: S + 3.05, label: avg(tm2, S + 0.95, S + 3.05) },
    ],
  });

  return {
    id: 'film',
    width: 1920,
    height: 1080,
    fps: 60,
    duration: DURATION,
    supersample: 6,
    background: '#0D0B09',
    chapters: chapters.map((c) => ({ t: c.tIn, title: c.line })),
    // Stage-only stretches (cold open, outro): a smooth glow under a static dither
    // that the main CRF would flatten into 8-16 px blocks. build.mjs gives them a
    // lower CRF through x264 zones.
    encodeHints: { zones: [{ from: 0, to: CO_EXIT + 0.9 }, { from: FALL + 0.4, to: DURATION }] },
    layers: [
      backdrop({ camera, intensity: [{ at: 0, v: 0.25 }, { at: 3.2, v: 1, ease: 'sineInOut' }] }),
      win,
      phone,
      edgeFade({
        spans: [
          { side: 'right', from: S + 4.15, to: X - 0.1, width: 440 }, // sidebar close-up: prose runs off the right
          { side: 'left', from: Y + 2.7, to: FALL - 0.2, width: 440 }, // agent sidebar close-up: prose runs off the left
        ],
      }),
      coldOpen({ name: 'Gajae Code App', tagline: 'Run the agent. Watch the work. Keep everything on your machine.', exitAt: CO_EXIT }),
      ...titles,
      badges,
      outro({
        tIn: OUTRO,
        lines: 'Signed. Notarized. Yours.',
        cta: 'Download for macOS',
        version: 'Public beta', // not a version number: the site resolves the latest release, the film does not
        url: 'devswha.github.io/gajae-code-app',
      }),
    ],
    shots: [sh1, sh3, sh2, shPhone],
  };
}
