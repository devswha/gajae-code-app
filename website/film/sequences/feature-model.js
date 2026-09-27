// Feature loop "model" (UI only, 1600x1000): the model + reasoning picker (C5).
//
// It opens with the picker open on Anthropic Opus 5.5 (frame 0 is the poster:
// provider, model and reasoning columns), the pointer goes down the reasoning
// column and picks High, the picker closes on "Anthropic Opus 5.5 · High". Then it
// dissolves back to the closed picker, opens it again and passes over ChatGPT,
// Anthropic and Fable 5.1 to Opus 5.5, which is frame 0 again (continuous footage).
//
// The crop is 940 CSS px wide (1880 source px for 1600 output px), so on the page's
// 840-px chapter stage the app shows at 0.89x, close to the 0.81x of the
// 1040-px conversation crops (work, permission, review): the UI no longer changes
// size as the stage swaps chapters. It frames the whole picker and the composer.
// The provider column stays in frame: the picker cannot be framed without it,
// and the pointer's path runs through it.

import { fadeIn, fadeOutPointer } from '/stage/lib/compose.js';

const DURATION = 9.3;
const BACK = 4.1;
const BACK_DUR = 0.6;
const CAM = [{ at: 0, x: 400, y: 50, w: 940 }];

export default async function featureModel({ reel }) {
  const p1 = await reel(['C5-model-picker', 'C1-compose']);
  const c5 = (t) => p1.at('C5-model-picker', t);
  const SEAM = c5(7.7); // pointer has just arrived on Opus 5.5

  const pick = {
    id: 'pick',
    reel: p1,
    end: BACK + BACK_DUR + 0.05,
    time: [
      [-0.5, c5(7.2)],
      [0, SEAM, 1],
      [0.9, c5(8.88)], // Medium
      [1.75, c5(9.96)], // High
      [2.6, c5(11.446), 1], // select High
      [3.3, c5(12.3)], // picker closed: "High"
      [BACK + BACK_DUR + 0.1, c5(12.9)],
    ],
    camera: CAM,
    pointer: 'arrow',
  };
  fadeOutPointer(pick, BACK - 0.15);

  const browse = {
    id: 'browse',
    reel: p1,
    start: BACK,
    zIndex: 10,
    opacity: fadeIn(BACK, BACK_DUR),
    time: [
      [BACK, c5(0.4)], // picker closed ("Default"), pointer beside it
      [BACK + BACK_DUR, c5(0.9)],
      [5.5, c5(1.747), 1], // click the picker button
      [6.5, c5(3.6)], // ChatGPT
      [7.45, c5(5.05)], // Anthropic
      [8.35, c5(6.45)], // Fable 5.1
      [DURATION, SEAM, 1], // Opus 5.5: frame 0 again
    ],
    camera: CAM,
    pointer: 'arrow',
  };

  return {
    id: 'feature-model', width: 1600, height: 1000, fps: 60, duration: DURATION, supersample: 4,
    shots: [pick, browse],
  };
}
