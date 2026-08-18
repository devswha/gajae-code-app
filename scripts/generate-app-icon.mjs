#!/usr/bin/env node
/**
 * Renders every app-icon asset from one artwork file.
 *
 * The app used to ship three different identities at once: the pixel-art
 * mascot in `public/icons/*.png`, a leftover chat bubble in the matching
 * `*.svg` files, and a third mark on the website. They drifted because each set
 * was drawn by hand and no single file said what the icon was. This script is
 * that file, and `public/brand/app-icon.png` is the artwork.
 *
 * Two properties of the artwork have to be corrected rather than copied:
 *
 * 1. Its rounded corners are painted black, not transparent, so pasting it
 *    edge-to-edge would put black corners on every platform that masks the icon
 *    itself. The source is therefore clipped to its own corner radius and laid
 *    over a plate of the artwork's own background colour. It is also drawn
 *    slightly oversized inside that clip, because the artwork carries a dark
 *    rim at its very edge which would otherwise survive as a hairline outline.
 * 2. Its content reaches a radius of ~27.6 in a 64-unit square, past the 25.6
 *    a `purpose: "maskable"` icon must survive. Full-bleed sizes scale the
 *    artwork down until it fits, so a circular mask cannot cut the hat brim.
 * 3. macOS wants the opposite of a maskable icon: the app draws its own
 *    squircle inside a transparent margin, so the desktop bundle gets its own
 *    variant rather than the full-bleed one. That variant is also the only
 *    output with real transparency, which matters because Tauri's bundler
 *    rejects an icon without an alpha channel.
 *
 * The mascot is untouched and still used wherever there is room for it
 * (`public/logo.png`: sidebar, auth screen, provider mark).
 *
 *   node scripts/generate-app-icon.mjs            # check the assets are current
 *   node scripts/generate-app-icon.mjs --write    # re-render them
 *   node scripts/generate-app-icon.mjs --preview  # local review page
 */
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { servePreview, writePreview } from './lib/app-icon-preview.mjs';

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (flag !== '--write' && flag !== '--preview') {
    throw new Error(`Usage: generate-app-icon.mjs [--write] [--preview]\nUnknown option: ${flag}`);
  }
}
const write = flags.has('--write');
const preview = flags.has('--preview');

/** The artwork, and the values measured from it. */
export const SOURCE = 'public/brand/app-icon.png';

/**
 * Fills behind and around the artwork. Sampled at the crop boundary rather than
 * at the centre: the artwork's background is faintly vignetted, and matching the
 * centre left a visible ring where the inset artwork met the flat fill.
 */
const PLATE = '#04112b';

/** The artwork's baked corner radius, as a fraction of its width. */
const SOURCE_CORNER = 0.21;

/** How much of the artwork's edge is cropped away to drop its dark rim. */
const RIM_CROP = 0.03;

/**
 * How much the artwork shrinks on full-bleed sizes so that its content clears
 * the maskable safe circle: 25.6 / 27.64, rounded down.
 */
const MASKABLE_FIT = 0.92;

/** macOS icon grid: the squircle fills 824 of a 1024 canvas, radius 185. */
const MACOS_INSET = 824 / 1024;
const MACOS_CORNER = 185 / 824;

/** PWA sizes declared in public/manifest.json. */
const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

/**
 * `bleed` icons are masked by the platform, so the plate runs to the edge and
 * the artwork is inset to survive a circular cut. The rest are shown as drawn
 * and keep the artwork's own silhouette.
 */
const ASSETS = [
  ...PWA_SIZES.map((size) => ({ file: `public/icons/icon-${size}x${size}.png`, size, bleed: true })),
  // The desktop bundle. Tauri assembles the .icns from these, matching each
  // PNG to an icns entry by its size and by the `@2x` in its name. There is no
  // 1024 entry at 1x — the format only carries that resolution as 512@2x — so a
  // file simply named for 1024 pixels fails with "No matching IconType".
  { file: 'src-tauri/icons/32x32.png', size: 32, macos: true },
  { file: 'src-tauri/icons/128x128.png', size: 128, macos: true },
  { file: 'src-tauri/icons/128x128@2x.png', size: 256, macos: true },
  { file: 'src-tauri/icons/512x512.png', size: 512, macos: true },
  { file: 'src-tauri/icons/512x512@2x.png', size: 1024, macos: true },
  { file: 'public/favicon.png', size: 64, bleed: false },
  // The mark the app draws inside its own window — sidebar header, loading
  // screen, and the gjc provider mark in chat. Left out of this list, it kept
  // the previous artwork while the Dock icon moved on, so the app wore two
  // identities at once.
  { file: 'public/logo.png', size: 256, bleed: true },
  { file: 'public/logo-32.png', size: 32, bleed: true },
  { file: 'public/logo-128.png', size: 128, bleed: true },
  { file: 'public/logo-256.png', size: 256, bleed: true },
  { file: 'public/logo-512.png', size: 512, bleed: true },
  { file: 'website/public/favicon.png', size: 32, bleed: false },
  { file: 'website/public/icon-96.png', size: 96, bleed: false },
  { file: 'website/public/icon-512.png', size: 512, bleed: false },
  { file: 'website/public/apple-touch-icon.png', size: 180, bleed: true },
];

const chromeExecutable = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return 'google-chrome';
};

/**
 * Composites one asset and screenshots it at exactly `size` pixels.
 *
 * The artwork carries its own corner radius, so clipping it to that radius
 * drops the black corners and lets the plate show through instead.
 */
async function render({ file, size, bleed, macos }, sourcePath) {
  const scale = macos ? MACOS_INSET : bleed ? MASKABLE_FIT : 1;
  const inner = size * scale;
  const artCorner = macos ? MACOS_CORNER : SOURCE_CORNER;
  const stagingDir = await fs.mkdtemp(path.join(rootDir, '.icon-render-'));
  try {
    const page = path.join(stagingDir, 'icon.html');
    await fs.writeFile(
      page,
      `<!doctype html><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:transparent}
        .plate{width:${size}px;height:${size}px;
               background:${macos ? 'transparent' : PLATE};
               border-radius:${bleed || macos ? 0 : size * SOURCE_CORNER}px;
               display:flex;align-items:center;justify-content:center;overflow:hidden}
        .art{width:${inner}px;height:${inner}px;overflow:hidden;
             background:${PLATE};
             border-radius:${inner * artCorner}px;
             display:flex;align-items:center;justify-content:center}
        img{width:${inner * (1 + RIM_CROP)}px;height:${inner * (1 + RIM_CROP)}px;
            display:block;flex:none}
      </style><div class="plate"><div class="art"><img src="file://${sourcePath}"></div></div>`,
    );
    await execFile(
      chromeExecutable(),
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',
        `--window-size=${size},${size}`,
        `--screenshot=${path.resolve(rootDir, file)}`,
        `file://${page}`,
      ],
      { timeout: 60_000 },
    );
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

const sourcePath = path.join(rootDir, SOURCE);
const sourceBytes = await fs.readFile(sourcePath).catch(() => null);
if (!sourceBytes) throw new Error(`Missing artwork: ${SOURCE}`);
const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex').slice(0, 16);

/**
 * Records which artwork the committed assets were rendered from, so the check
 * below can tell "already current" from "someone replaced the artwork".
 */
const STAMP = 'public/icons/.source';

if (preview) {
  const outDir = await writePreview(rootDir, { assets: ASSETS, source: SOURCE, plate: PLATE });
  const port = Number(process.env.ICON_PREVIEW_PORT ?? 4190);
  await servePreview(outDir, port);
  console.log(`Icon review page on http://localhost:${port}  (Ctrl-C to stop)`);
  console.log(`Served from ${path.relative(rootDir, outDir)}/ — gitignored, not a build input.`);
}

const stampPath = path.join(rootDir, STAMP);
const stamped = await fs.readFile(stampPath, 'utf8').catch(() => null);
const missing = [];
for (const asset of ASSETS) {
  const exists = await fs
    .access(path.join(rootDir, asset.file))
    .then(() => true)
    .catch(() => false);
  if (!exists) missing.push(asset.file);
}

if (write) {
  for (const asset of ASSETS) {
    await fs.mkdir(path.dirname(path.join(rootDir, asset.file)), { recursive: true });
    await render(asset, sourcePath);
    const note = asset.macos ? ', macOS squircle' : asset.bleed ? ', full-bleed' : '';
    console.log(`wrote ${asset.file} (${asset.size}px${note})`);
  }
  await fs.writeFile(stampPath, `${sourceDigest}\n`);
} else if (!preview) {
  const stale = stamped?.trim() !== sourceDigest;
  if (stale || missing.length) {
    console.error(
      [
        stale ? `${SOURCE} changed since the icons were rendered.` : 'App icons are missing:',
        ...missing.map((file) => `  ${file}`),
        '',
        'Run: npm run icon:generate',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(`App icons are current with ${SOURCE}.`);
}
