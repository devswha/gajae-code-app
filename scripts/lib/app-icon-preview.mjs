/**
 * Local review page for the rendered app icons.
 *
 * It serves the actual generated files, not a re-drawing of them, so what you
 * review is byte-for-byte what ships. The platform-mask row is the one that
 * matters: it is how the artwork's overflowing hat brim was caught in the first
 * place.
 *
 * The output directory is gitignored and belongs to no build input. An earlier
 * icon studio was wired into the website's Rollup inputs and shipped its
 * rejected drafts to production; this one cannot, because nothing references it.
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = '.icon-preview';

const page = ({ assets, source, plate }) => {
  const bleed = assets.filter((a) => a.bleed);
  const drawn = assets.filter((a) => !a.bleed);
  const biggestBleed = bleed.reduce((a, b) => (a.size > b.size ? a : b));

  const strip = (list, background) => `
    <div class="swatch" style="background:${background}">
      ${list
        .slice()
        .sort((a, b) => b.size - a.size)
        .map(
          (a) => `<div class="stack"><img src="/asset/${a.file}" width="${Math.min(a.size, 180)}"
                    height="${Math.min(a.size, 180)}"><br>${a.size}</div>`,
        )
        .join('')}
    </div>`;

  const shrink = (list, background) => `
    <div class="swatch" style="background:${background}">
      ${[64, 48, 32, 24, 16]
        .map(
          (px) =>
            `<div class="stack"><img src="/asset/${list.file}" width="${px}" height="${px}"><br>${px}</div>`,
        )
        .join('')}
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gajae app icon — review</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #131316; color: #e7e7ea;
         font: 13px/1.5 -apple-system, "Pretendard Variable", sans-serif; }
  header { padding: 14px 20px; border-bottom: 1px solid #2a2a30; display: flex; gap: 14px; }
  header h1 { margin: 0; font-size: 14px; font-weight: 600; }
  header .note { color: #82828c; }
  main { padding: 18px; display: grid; gap: 14px; }
  .panel { background: #1b1b20; border: 1px solid #2a2a30; border-radius: 12px; padding: 14px; }
  .panel h2 { margin: 0 0 4px; font-size: 11px; font-weight: 600;
              letter-spacing: .09em; text-transform: uppercase; color: #82828c; }
  .panel p { margin: 0 0 10px; color: #82828c; }
  .swatch { padding: 14px 16px; border-radius: 10px; display: flex; gap: 16px;
            align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
  .stack { text-align: center; color: #9a9aa4; font-size: 11px; }
  .masks { display: flex; gap: 16px; align-items: center; }
  .masks img { width: 128px; height: 128px; }
  .circle { border-radius: 50%; }
  .squircle { border-radius: 27px; }
  code { color: #cfcfd6; }
</style>
</head>
<body>
<header>
  <h1>Gajae app icon</h1>
  <span class="note">rendered from <code>${source}</code> — the files below are the ones that ship.
    Local only; never built or shipped.</span>
</header>
<main>
  <div class="panel">
    <h2>platform masks — nothing may clip</h2>
    <p>Full-bleed sizes are inset so a circular mask cannot cut the hat brim.</p>
    <div class="masks">
      <img class="circle" src="/asset/${biggestBleed.file}" alt="circular mask">
      <img class="squircle" src="/asset/${biggestBleed.file}" alt="squircle mask">
      <img src="/asset/${biggestBleed.file}" alt="square">
      <span class="note">circle · squircle · square</span>
    </div>
  </div>
  <div class="panel">
    <h2>full-bleed sizes — PWA and Apple touch</h2>
    <p>Plate runs to the edge; the platform decides the silhouette.</p>
    ${strip(bleed, '#08080a')}
    ${strip(bleed, '#f4f4f6')}
  </div>
  <div class="panel">
    <h2>shown as drawn — favicon and site mark</h2>
    <p>Keeps the artwork's own corner.</p>
    ${strip(drawn, '#08080a')}
    ${strip(drawn, '#f4f4f6')}
  </div>
  <div class="panel">
    <h2>favicon at real sizes</h2>
    <p>The acid test: 16px in a browser tab.</p>
    ${shrink(drawn.find((a) => a.size === 64) ?? drawn[0], '#08080a')}
    ${shrink(drawn.find((a) => a.size === 64) ?? drawn[0], '#f4f4f6')}
    ${shrink(drawn.find((a) => a.size === 64) ?? drawn[0], plate)}
  </div>
</main>
</body>
</html>
`;
};

/** Writes the review page. Assets are served from the repo, not copied. */
export async function writePreview(rootDir, options) {
  const outDir = path.join(rootDir, OUTPUT_DIR);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index.html'), page(options));
  await fs.writeFile(path.join(outDir, 'assets.json'), JSON.stringify(options.assets));
  return outDir;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

/**
 * Serves the review page, plus the generated assets under `/asset/<repo path>`.
 * Read-only, and every path is confined to the repo root.
 */
export function servePreview(directory, port, host = '0.0.0.0') {
  const rootDir = path.dirname(directory);
  const server = createServer(async (request, response) => {
    const requested = (request.url ?? '/').split('?')[0];
    const isAsset = requested.startsWith('/asset/');
    const base = isAsset ? rootDir : directory;
    const name = isAsset ? requested.slice('/asset'.length) : requested === '/' ? '/index.html' : requested;
    const file = path.join(base, path.normalize(name).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(base)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
