// Tiny static server for the stage.
//   /stage/*      -> website/film/stage
//   /sequences/*  -> website/film/sequences
//   /public/*     -> website/public (fonts, brand art)
//   /footage/*    -> $GAJAE_CAPTURE_DIR/clips (raw capture; lives outside the repo)
//
// Run directly for authoring:  node engine/server.mjs  -> prints the URL.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEBSITE_DIR = path.resolve(FILM_DIR, '..');

export function captureDir() {
  const dir = process.env.GAJAE_CAPTURE_DIR;
  if (!dir) {
    throw new Error(
      'GAJAE_CAPTURE_DIR is not set. Point it at the capture folder that holds clips/<id>/ (see website/film/README.md).',
    );
  }
  const clips = path.join(dir, 'clips');
  if (!fs.existsSync(clips)) throw new Error(`${clips} does not exist`);
  return path.resolve(dir);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export function startServer({ port = 0 } = {}) {
  const roots = {
    stage: path.join(FILM_DIR, 'stage'),
    sequences: path.join(FILM_DIR, 'sequences'),
    public: path.join(WEBSITE_DIR, 'public'),
    footage: path.join(captureDir(), 'clips'),
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, mount, ...rest] = decodeURIComponent(url.pathname).split('/');
    const root = roots[mount];
    const file = root ? path.resolve(root, rest.join('/') || 'index.html') : null;
    if (!file || !file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': mount === 'footage' || mount === 'public' ? 'max-age=86400' : 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${p}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { origin } = await startServer({ port: Number(process.env.PORT ?? 4310) });
  console.log(`stage server: ${origin}/stage/?seq=<sequence-id>&debug=1&play=1`);
}
