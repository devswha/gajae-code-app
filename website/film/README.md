# Film compositor

Source for the homepage motion: the product film, the hero loop and the
feature loops. It turns real capture footage of the app into
finished video. Nothing here is built or installed by CI; the rendered files are
committed under `website/public/media/`.

Every frame is real product footage. The engine only crops, zooms, retimes,
dissolves, and draws the pointer that the headless capture could not record,
at the positions and times logged during capture.

## Requirements

- Node 22 (`. "$HOME/.nvm/nvm.sh" && nvm use 22`)
- ffmpeg with libx264, libsvtav1 (and `cwebp` for the WebP posters)
- Playwright's Chromium: `npm install` here, then `npx playwright install chromium`
  if no build is cached. Or point `FILM_PLAYWRIGHT_DIR` at any folder whose
  `node_modules` has playwright.
- The raw capture. It lives **outside the repo** (it is several GB of JPEG
  frames). Set `GAJAE_CAPTURE_DIR` to the capture folder, the one that holds
  `clips/<clip-id>/{frames/,timestamps.json,events.json,frames.ffconcat}`.

```sh
export GAJAE_CAPTURE_DIR=/path/to/capture
export FILM_WORK_DIR=/path/to/scratch      # lossless masters; default <tmp>/gajae-film-work
```

## Render

```sh
npm run loops                          # render, encode, poster and QC every UI loop
npm run loops -- hero phone            # only some jobs (see JOBS in engine/build.mjs)
npm run loops -- --skip-render         # re-encode from existing masters

node engine/render.mjs hero-loop                         # master only (FFV1 .mkv)
node engine/render.mjs hero-loop --stills 0,5.3,15.3     # PNG stills for review
node engine/encode.mjs h264 master.mkv out.mp4 --budget 5MB --crf 18
node engine/encode.mjs av1  master.mkv out.webm --budget 4MB --crf 24
node engine/encode.mjs poster master.mkv poster.webp poster.jpg
node engine/qc.mjs out.mp4 --expect 1920x1200@60 --budget 5MB --min 14 --max 20 \
  --frames 0,5,last --dir qc/
npm run serve   # then open /stage/?seq=hero-loop&debug=1&play=1 to preview in real time
```

## How it works

- `stage/` is a page with one pure function, `window.__seek(T)`. It sets every
  element for timeline second `T` and resolves once the right footage frame is
  decoded. Nothing reads the clock and CSS transitions/animations are disabled,
  so any frame can be rendered in any order and always gives the same pixels.
- `stage/lib/reel.js` joins clips cut from one recording into a reel on a single
  clock (`wallMs`). Frames are variable-rate: each is held until the next timestamp.
- `stage/lib/timemap.js` maps timeline time to footage time through anchors
  `[T, t, speed?]`, using a monotone cubic. Speed ramps are smooth, anchors land
  exactly, so a logged click stays on its frame, and footage never runs backwards.
- `stage/lib/camera.js` holds eased crop/zoom keys in capture CSS px. Zoom is
  interpolated in log space. A key that would upscale past the source's native
  resolution, or leave the frame, throws.
- `stage/lib/pointer.js` builds a vector macOS arrow (desktop) or a touch
  indicator (phone) from `events.json`. It follows minimum-jerk arced paths,
  arrives on the logged target at the logged time, and dips on press with an
  analytic spring on release.
- `engine/render.mjs` runs Playwright Chromium at the exact output size with
  deviceScaleFactor 1. It pipes PNG screenshots into ffmpeg (`image2pipe`,
  nothing dumped to disk). The optional N-times temporal supersampling uses a
  180° shutter and a `tmix` average, which gives motion blur on camera moves.
  Output is a lossless FFV1 master.
- `engine/encode.mjs` converts sRGB to BT.709 limited range and tags
  primaries, transfer and matrix, so the orange and green do not shift. It
  starts at a high-quality CRF and raises it only until the file fits its budget.
- `engine/qc.mjs` checks dimensions, fps, duration, codec, colour tags, audio,
  size and faststart. It also checks for black frames and luma flashes, measures
  the loop seam (last vs first frame PSNR), and writes review frames.

## The product film

`sequences/film.js` is the homepage film (1920×1080, 60 fps, silent, about 81 s):
cold open on the real mark, eight chapters, outro. It is built from the same
parts plus the film kit in `stage/lib/film.js`:

- `worldCamera` — eased `{cx, cy, k}` keys over a "world" measured in desktop
  capture CSS px (the window's content origin is 0,0); `k` is output px per CSS
  px, so `k ≤ 2` keeps a 2× capture at or above native resolution (the stage
  throws if a shot is ever drawn larger than its source).
- `macWindow` / `phoneFrame` — window chrome (traffic lights, hairline, layered
  shadow) and a generic phone (drawn here, no vendor artwork). Each builds a
  content container; a shot with `container: '<id>'` and `frame: win.frame`
  fills it at the camera's scale. Everything is laid out in px each frame (no
  CSS transform scaling), so text stays sharp at every zoom.
- `backdrop` (warm-dark stage, slow orange / visor-green glow with parallax,
  static dither against banding), `titleCard` (Geist Mono eyebrow + Gajae Web
  Sans line; mask sweep, per-word blur-to-sharp and rise), `speedBadge` (the
  `×N` pill, labelled with the real average speed of the span), `coldOpen`
  (the mark's parts from `public/brand/mark.svg` powered on in turn), `outro`
  and `edgeFade` (a soft stage-coloured falloff on one frame edge for close-ups
  whose crop has to run through prose).
- Title cards sit under the window and the phone (z-order), and each card has
  fully exited before the next push-in starts, so type never draws over live UI.
- `encodeHints.zones` (returned by the sequence, passed through the stage meta)
  marks the stage-only stretches (cold open, outro); `build.mjs` encodes them at
  a lower x264 CRF so the dithered glow does not block up.
- The phone and desktop footage of chapter 7 are separate recordings; both
  logged the phone's Allow on one wall clock, so the desktop source time is the
  phone source time plus that offset and the desktop card closes on the tap.

```sh
npm run loops -- film                    # render (~16 min, 8 workers, 6x supersampled), encode, poster, chapters.json, QC
node engine/render.mjs film --stills 6.5,33.2,61.5   # review frames
```

Outputs: `public/media/film/gajae-code-app-film.mp4` (H.264 High, 8-bit; the
cold-open and outro zones at CRF 21, the rest at the lowest CRF that fits 11.8 MB),
`film-poster.{webp,jpg}` (the frame at `posterAt`), `chapters.json`
(`[{t, title}]` for each chapter card). Files are written world-readable (644/755).

There is no film WebM. An AV1 test (10-bit, SVT film-grain 6-8) blocked the dark
cold-open glow worse than the H.264 zones, and the extra file would push
`public/media` past its 40 MB budget.

## Add a sequence

Create `sequences/<id>.js` exporting `async ({ reel }) => ({ width, height, fps,
duration, supersample, shots, layers? })`. A shot is `{ id, reel, time, camera,
pointer: 'arrow' | 'touch' | null, start?, end?, offset?, opacity?, skip?, zIndex?,
container?, frame? }` (`container` + `frame` put the shot inside a layer's box, as the film does).
`loopTail(shot, { duration, crossfade })` from `stage/lib/compose.js` makes the
loop seamless; it also fades the outgoing shot's pointer out in the first 0.15 s
of the dissolve so only one pointer shows through the seam (call
`fadeOutPointer(otherShot, duration - crossfade)` if a different shot is on
screen at the loop's end). `layers` (`{ mount(stageEl), seek(T) }`) add any other DOM, such as
a window frame, titles or a background, and must also be pure functions of T.
Then add an entry to `JOBS` in `engine/build.mjs` if it is a deliverable.

### Loops that seam on real footage

Most UI loops (hero, work, model, worktree) do not dissolve at the seam. They
open on the most informative moment (frame 0 is also the poster and the
reduced-motion image), play forward, dissolve once in the middle back to an
earlier moment of the same take, and play forward again until they reach
frame 0's source time. Two shots on one reel do it: the first ends after the
mid dissolve (`fadeOutPointer` it just before, so only one pointer shows), the
second starts there with `opacity: fadeIn(...)` and its last anchor is
`[duration, <frame 0's source time>, 1]`. The seam is then continuous footage.

### Dips, not dissolves, between two text-heavy states

A cross-dissolve between two different UI states lays one screen of text over
another for half a second, which reads as a rendering bug. Where the two frames
differ in text (hero: summary to empty composer; work: the three segments;
worktree: the sidebar reflows the prose; permission and states at the seam), use
a dip through the stage background instead: `opacity: fadeOut(at, 0.12)` on the
outgoing shot and `fadeIn(at + 0.12, 0.12)` on the incoming one, and set the
sequence's `background: '#141414'` (the app's own background) so the dip reads as
the UI blinking, not a black flash. `loopTailDip(shot, { duration, dip })` is the
dip version of `loopTail`. Keep a true dissolve only where the frames match apart
from small changes (the model loop's closed picker).

Posters are frame 0, so frame 0 should not show a parked pointer: hide it with
`pointerOpacity` keys (0 at frame 0, up before its first move, down again once
it rests near the loop's end), or pick a frame 0 where it rests on a control.

### Legibility

Every loop is shown on the page smaller than it is rendered. Size the crop
(`w`, in capture CSS px) so the app's UI lands at 0.8x or more of its real size
where the loop is displayed: `displayed width / w >= 0.8` (the app's 14 px text
at 11 px or more). The page's chapter stage is 840 px wide at 1280 and up. The
feature crops are 1040 CSS px (work, permission, review: 0.81x), 940 (model,
states: 0.89x) and 800 (worktree: 1.05x, for its small Environment panel); 800 is
the native limit (2 source px per CSS px, 1600 px output). Keep the chapters
within about 0.8-0.9x so the app does not change size as the stage swaps. The
hero is the whole 1440 px window.
