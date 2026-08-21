export type BrowserViewportSize = {
  width: number;
  height: number;
};

export const DEFAULT_BROWSER_VIEWPORT: BrowserViewportSize = { width: 1280, height: 800 };
export const MIN_BROWSER_VIEWPORT: BrowserViewportSize = { width: 240, height: 160 };
export const MAX_BROWSER_VIEWPORT: BrowserViewportSize = { width: 2560, height: 1600 };

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(Math.max(Math.round(value), minimum), maximum)
);

export function normalizeBrowserViewport(width: unknown, height: unknown): BrowserViewportSize | null {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null;
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  return {
    width: clamp(width, MIN_BROWSER_VIEWPORT.width, MAX_BROWSER_VIEWPORT.width),
    height: clamp(height, MIN_BROWSER_VIEWPORT.height, MAX_BROWSER_VIEWPORT.height),
  };
}

type BrowserFramePointInput = {
  clientX: number;
  clientY: number;
  boundsLeft: number;
  boundsTop: number;
  boundsWidth: number;
  boundsHeight: number;
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

/** Maps a pointer in an object-contain image to Chromium viewport coordinates. */
export function browserFramePoint(input: BrowserFramePointInput): { x: number; y: number } | null {
  const dimensions = [
    input.boundsWidth,
    input.boundsHeight,
    input.frameWidth,
    input.frameHeight,
    input.viewportWidth,
    input.viewportHeight,
  ];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  const scale = Math.min(
    input.boundsWidth / input.frameWidth,
    input.boundsHeight / input.frameHeight,
  );
  const renderedWidth = input.frameWidth * scale;
  const renderedHeight = input.frameHeight * scale;
  const renderedLeft = input.boundsLeft + ((input.boundsWidth - renderedWidth) / 2);
  const renderedTop = input.boundsTop + ((input.boundsHeight - renderedHeight) / 2);
  const localX = input.clientX - renderedLeft;
  const localY = input.clientY - renderedTop;
  if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) return null;

  return {
    x: (localX / renderedWidth) * input.viewportWidth,
    y: (localY / renderedHeight) * input.viewportHeight,
  };
}
