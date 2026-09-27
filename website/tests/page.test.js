import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DMG_FACTS, MEDIA, RECORDED_VERSION, renderLandingPage } from '../src/page.js';
import { LANDING_PAGE_MARKER, injectLandingPage } from '../src/prerender.js';
import {
  APPLE_GATEKEEPER_HELP_URL,
  DOWNLOADS,
  GAJAE_CODE_URL,
  RELEASE,
  REPOSITORY_URL,
  buildDownloads,
} from '../src/releases.js';

const PUBLIC_DIR = new URL('../public/', import.meta.url);
const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_JS = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const SOURCES = ['page.js', 'prerender.js', 'main.js'].map((file) =>
  readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
);

/** Every file under a directory of website/public, as a path relative to public/. */
function publicFiles(dir) {
  const publicRoot = fileURLToPath(PUBLIC_DIR);
  return readdirSync(join(publicRoot, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(publicRoot, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'));
}

function section(html, id) {
  const match = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`));
  assert.ok(match, `section #${id} exists`);
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function visibleText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every local file the markup points at: src, srcset, poster, href and data-film-src. */
function localReferences(html) {
  const refs = new Set();
  for (const [, attr, value] of html.matchAll(/\b(src|srcset|poster|data-poster|href|data-film-src)="([^"]+)"/g)) {
    const candidates = attr === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/)[0]) : [value];
    for (const candidate of candidates) {
      if (/^(?:https?:|mailto:|#|data:)/.test(candidate) || candidate.startsWith('./src/')) continue;
      refs.add(candidate.replace(/^\.\//, ''));
    }
  }
  return [...refs];
}

test('landing page exposes the pinned GitHub download buttons', () => {
  const html = renderLandingPage();
  assert.match(html, /id="download"/);
  for (const key of ['macosArm64', 'linuxServer']) {
    assert.ok(html.includes(`href="${DOWNLOADS[key].href}"`), `${key} download is linked`);
    assert.ok(html.includes(`href="${DOWNLOADS[key].checksumHref}"`), `${key} checksum is linked`);
  }
  assert.match(html, /Download for macOS/);
  assert.equal(html.includes('Download for Linux'), false);
  const releaseHrefs = [...html.matchAll(/href="([^"]*\/releases\/download\/[^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(releaseHrefs.sort(), [
    DOWNLOADS.macosArm64.href,
    DOWNLOADS.macosArm64.href,
    DOWNLOADS.macosArm64.checksumHref,
    DOWNLOADS.linuxServer.href,
    DOWNLOADS.linuxServer.checksumHref,
  ].sort(), 'only the pinned macOS DMG (hero + download), its checksum and the server archive + checksum are linked');
  assert.equal(html.includes('linux-download'), false);
  assert.equal(html.includes('Windows용 내려받기'), false);
  assert.equal(html.includes('Download for Windows'), false);
  assert.equal(html.includes('/latest/download/'), false);
  assert.match(html, new RegExp(escapeRegExp(RELEASE.tag)));
  assert.doesNotMatch(html, /\.(?:AppImage|deb|rpm|exe|msi)"/);
  assert.doesNotMatch(html, /macos-x64|intel\.dmg|darwin-x86_64/i);
});

test('the header download button scrolls to the download section instead of linking a file', () => {
  const html = renderLandingPage();
  const header = html.slice(html.indexOf('<header class="site-header"'), html.indexOf('</header>'));
  assert.match(header, /href="#download">Download<\/a>/);
  assert.equal(header.includes('/releases/download/'), false);
});

test('leads with the app’s own tagline and positions it as the desktop app for Gajae Code', () => {
  const hero = section(renderLandingPage(), 'top');
  assert.match(hero, /<h1 id="hero-title">Run the agent\.<br \/><span class="h1-second">Watch the work\.<\/span><\/h1>/);
  assert.match(hero, /class="lede">\s*The desktop app for Gajae Code\./);
  assert.ok(hero.includes(`href="${GAJAE_CODE_URL}">About Gajae Code</a>`));
  assert.match(hero, new RegExp(`Public beta · v${escapeRegExp(RELEASE.version)}`));
});

test('makes the macOS download primary and source and server setup secondary', () => {
  const hero = section(renderLandingPage(), 'top');
  const primary = hero.slice(hero.indexOf('class="cta-row"'), hero.indexOf('class="platform-note"'));
  assert.ok(primary.length > 0, 'the CTA row comes before the platform note');
  assert.ok(primary.includes(`href="${DOWNLOADS.macosArm64.href}"`));
  assert.match(primary, /Download for macOS/);
  assert.equal(primary.includes('Download for Linux'), false);
  assert.equal(primary.includes('#linux-download'), false);
  assert.equal(primary.includes(DOWNLOADS.linuxServer.href), false);
  assert.equal(primary.includes(REPOSITORY_URL + '"'), false);
  assert.equal(hero.includes('button-icon'), false);
  assert.match(hero, /href="#self-host">Server setup/);
  assert.ok(hero.includes(`href="${REPOSITORY_URL}">Source code</a>`));
});

test('keeps the desktop download section macOS-only and the server archive under self-host', () => {
  const html = renderLandingPage();
  const desktop = section(html, 'download');
  const selfHost = section(html, 'self-host');
  assert.ok(desktop.includes(DOWNLOADS.macosArm64.href));
  assert.equal(desktop.includes('Linux desktop'), false);
  for (const [, href] of desktop.matchAll(/href="([^"]+)"/g)) {
    assert.ok(
      [DOWNLOADS.macosArm64.href, DOWNLOADS.macosArm64.checksumHref, '#macos-install'].includes(href),
      `desktop section links macOS artifacts only, got: ${href}`,
    );
  }
  assert.equal(desktop.includes('DESKTOP-LINUX.md'), false);
  assert.equal(desktop.includes(DOWNLOADS.linuxServer.href), false);
  assert.match(desktop, /Intel Mac and Windows builds are not available\./);
  // Windows is not planned (issue #175 closed as not planned), so nothing may promise it.
  assert.doesNotMatch(html, /not available yet|coming soon/i);
  assert.equal(html.includes('Linux desktop builds are not available yet'), false);
  assert.ok(selfHost.includes(DOWNLOADS.linuxServer.href));
  assert.match(selfHost, /Requires Node\.js 22\.22\.2\+ \(22\.x\)/);
  assert.match(selfHost, /x86_64 · glibc 2\.35\+/);
});

test('does not nest sections inside the sections the tests slice by id', () => {
  const html = renderLandingPage();
  for (const id of ['top', 'download', 'self-host', 'macos-install', 'faq']) {
    assert.equal(section(html, id).includes('<section'), false, `#${id} has no nested <section>`);
  }
});

test('gives each checksum link a distinct accessible name', () => {
  const html = renderLandingPage();
  for (const [key, label] of [
    ['macosArm64', 'macOS DMG'],
    ['linuxServer', 'Linux server archive'],
  ]) {
    assert.ok(html.includes(`href="${DOWNLOADS[key].checksumHref}" aria-label="SHA-256 for ${label}"`));
  }
  const checksumLabels = [...html.matchAll(/aria-label="SHA-256 for ([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(checksumLabels.sort(), ['Linux server archive', 'macOS DMG']);
});

test('every in-page link, label and accessibility reference has a unique target', () => {
  const html = renderLandingPage();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const [, target] of html.matchAll(/(?:href="#|aria-describedby="|aria-labelledby="|for=")([^"]+)"/g)) {
    assert.ok(ids.includes(target), `#${target} exists`);
  }
  assert.equal(html.includes('linux-download'), false);
  assert.match(html, /href="#main"/);
});

test('keeps page and social metadata aligned with the desktop app positioning', () => {
  const html = INDEX_HTML;
  assert.match(html, /<title>Gajae Code App — The desktop app for Gajae Code<\/title>/);
  assert.match(html, /property="og:title" content="Gajae Code App — The desktop app for Gajae Code"/);
  assert.match(html, /name="twitter:title" content="Gajae Code App — The desktop app for Gajae Code"/);
  assert.match(html, /Available for macOS, with a self-hosted Linux server archive\./);
  assert.equal(html.includes('with a desktop'), false);
  assert.match(html, /property="og:image" content="https:\/\/devswha\.github\.io\/gajae-code-app\/media\/og\/og-image\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/devswha\.github\.io\/gajae-code-app\/media\/og\/og-image\.jpg"/);
  assert.match(html, /name="theme-color" content="#0D0B09"/);
  assert.ok(existsSync(new URL('media/og/og-image.jpg', PUBLIC_DIR)), 'the og:image file ships with the site');
  assert.equal(html.includes('screenshots/'), false);
});

test('prerenders into index.html and preloads the self-hosted sans', () => {
  assert.match(INDEX_HTML, new RegExp(`<div id="app">${escapeRegExp(LANDING_PAGE_MARKER)}</div>`));
  assert.match(
    INDEX_HTML,
    /<link rel="preload" href="\.\/fonts\/GajaeWebSans-Variable-latin\.woff2" as="font" type="font\/woff2" crossorigin \/>/,
  );
  assert.doesNotMatch(INDEX_HTML, /fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg/);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /font-family: "Gajae Web Sans";/);
  assert.match(css, /font-family: "Geist Mono";/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?(?:https?:)?\/\//, 'no external CSS requests');
});

test('build-time prerender injects the page and honors the release override', () => {
  const html = injectLandingPage(INDEX_HTML, { releaseTag: 'v9.9.9-test', publishedLabel: '2031-01-02' });
  assert.equal(html.includes(LANDING_PAGE_MARKER), false);
  const overridden = buildDownloads({ version: '9.9.9-test', tag: 'v9.9.9-test' });
  assert.ok(html.includes(`href="${overridden.macosArm64.href}"`));
  assert.ok(html.includes('Public beta · v9.9.9-test'));
  assert.ok(html.includes('2031-01-02'));
  // The footage was recorded in a fixed release; the caption must not follow the override.
  assert.ok(html.includes(`recorded in v${RECORDED_VERSION}`));
  const fallback = injectLandingPage(INDEX_HTML, { releaseTag: 'latest' });
  assert.ok(fallback.includes(`href="${DOWNLOADS.macosArm64.href}"`));
  assert.throws(() => injectLandingPage('<html></html>'), /marker/);
});

test('states that the macOS beta is notarized and keeps the legacy Gatekeeper path for older builds', () => {
  const html = renderLandingPage();
  assert.match(html, /Public beta/);
  assert.match(visibleText(html), /Apple Silicon · macOS 13\+ · Notarized by Apple/);
  // Each segment is unbreakable, so a narrow screen wraps only at a separator.
  assert.match(html, /<span>Apple Silicon<\/span> · <span>macOS 13\+<\/span> · <span>Notarized by Apple<\/span>/);
  assert.match(STYLES, /\.platform-note span \{\s*white-space: nowrap;/);
  assert.equal(html.includes('Not notarized'), false);
  assert.equal(html.includes('has not been notarized'), false);
  assert.match(html, /System Settings → Privacy &amp; Security/);
  assert.match(html, /Open Anyway/);
  assert.match(html, /Only a build older than beta\.7/);
  assert.match(html, new RegExp(escapeRegExp(APPLE_GATEKEEPER_HELP_URL)));
  assert.match(html, /aria-describedby="macos-beta-notice"/);
  assert.match(html, /id="macos-install"/);
  assert.ok(section(html, 'macos-install').includes(DOWNLOADS.macosArm64.verifyCommand));
});

test('every media file the page references exists in website/public', () => {
  const html = renderLandingPage();
  const refs = [...localReferences(html), ...localReferences(INDEX_HTML)];
  assert.ok(refs.length > 20, 'the page references its media');
  const missing = refs.filter((ref) => !existsSync(new URL(ref, PUBLIC_DIR)));
  assert.deepEqual(missing, [], 'every referenced file is in website/public');
  for (const ref of refs.filter((path) => path.startsWith('media/'))) {
    assert.ok(statSync(new URL(ref, PUBLIC_DIR)).size < 15 * 1024 * 1024, `${ref} is under 15 MB`);
  }
  // Serve the webp mascot, never the heavy PNGs; the pixel wordmark on dark uses its dark variant.
  assert.equal(html.includes('mascot.png'), false);
  assert.equal(html.includes('mascot-600.png'), false);
  assert.ok(html.includes('brand/wordmark-pixel-on-dark.webp'));
  assert.equal(html.includes('brand/wordmark-pixel.webp'), false);
});

test('videos are muted inline loops with posters that never autoplay from markup', () => {
  const html = renderLandingPage();
  const videos = [...html.matchAll(/<video\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(videos.length >= 10, 'hero window, hero phone, six chapters, phone and film');
  for (const video of videos) {
    assert.match(video, /\bmuted\b/, video);
    assert.match(video, /\bplaysinline\b/, video);
    assert.match(video, /\b(?:data-)?poster="\.\/media\/[^"]+"/, video);
    assert.match(video, /\baria-label="[^"]{20,}"/, video);
    assert.doesNotMatch(video, /\bautoplay\b/, video);
    assert.match(video, /\bwidth="\d+" height="\d+"/, video);
  }
  const loops = videos.filter((video) => video.includes('data-loop'));
  assert.equal(loops.length, videos.length - 1);
  for (const video of loops) {
    assert.match(video, /\bloop\b/);
    assert.match(video, /preload="none"/, video);
  }
  // Only the desktop hero window paints its poster eagerly. Every other poster is lazy
  // (data-poster, set by main.js near the viewport) with a <noscript> image as the no-JS stand-in.
  const eager = videos.filter((video) => /\sposter="/.test(video));
  assert.equal(eager.length, 1);
  assert.match(eager[0], new RegExp(`poster="\\./${escapeRegExp(MEDIA.hero.poster)}"`));
  const lazyLoops = loops.filter((video) => video.includes('data-poster='));
  assert.equal(lazyLoops.length, loops.length - 1);
  assert.equal((html.match(/<noscript><img class="loop-fallback"/g) ?? []).length, lazyLoops.length);
  // The film loads only when its dialog opens: no src, no <source>, preload none, native controls.
  const film = html.match(/<video class="film-video"[^>]*><\/video>/);
  assert.ok(film, 'film video is empty until opened');
  assert.doesNotMatch(film[0], /\ssrc=/);
  assert.doesNotMatch(film[0], /\sposter=/, 'the closed dialog does not fetch the film poster');
  assert.match(film[0], /\bcontrols\b/);
  assert.match(film[0], /preload="none"/);
  assert.match(film[0], new RegExp(`data-film-src="\\./${escapeRegExp(MEDIA.film.mp4)}"`));
  assert.match(html, /<dialog class="film-dialog" id="film-dialog" aria-labelledby="film-dialog-title">/);
  // Without JavaScript the film trigger is a plain link to the file.
  assert.match(html, new RegExp(`href="\\./${escapeRegExp(MEDIA.film.mp4)}" data-film-open`));
});

test('describes the shipping app only: no retired review features, no unreleased push', () => {
  const html = renderLandingPage();
  const text = visibleText(html);
  for (const retired of [/line comment/i, /Send \d+ comments?/i, /Send N comments/i, /Changes tab/i, /Last-turn/i]) {
    assert.doesNotMatch(html, retired, `no ${retired}`);
  }
  for (const unreleased of [/web push/i, /push notification/i, /notifications? (?:to|on) your phone/i]) {
    assert.doesNotMatch(text, unreleased, `no ${unreleased}`);
  }
  assert.equal(html.includes('screenshots/'), false, 'retired beta.7 screenshots are gone');
  assert.equal(html.includes('demos/'), false);
  assert.equal(html.includes('-light.jpg'), false);
  // Phone access is never implied to work out of the box.
  const phone = section(html, 'phone');
  assert.match(phone, /Not out of the box/);
  assert.match(phone, /tailnet/);
  assert.match(phone, /VPN/);
  // No invented numbers, testimonials or model claims.
  assert.doesNotMatch(text, /GPT-|Opus|Sonnet|Gemini|testimonial|trusted by|\d[\d,]*\+? (?:users|downloads|stars)/i);
});

test('keeps the chapter headlines and the permission modes true to the product', () => {
  const html = renderLandingPage();
  for (const headline of [
    'Watch the work happen.',
    'Commands wait for you.',
    'Read the diff. Reply in the composer.',
    'Match the model to the task.',
    'Isolated by default.',
    'Every session, at a glance.',
    'Approve from your phone.',
  ]) {
    assert.ok(html.includes(headline), headline);
  }
  // The permission table must match the README's table row for row.
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const rows = [...readme.matchAll(/^\| \*\*(Ask|Auto-approve edits|Bypass)\*\*[^|]*\| ([^|]+) \| ([^|]+) \|$/gm)];
  assert.equal(rows.length, 3, 'README permission table found');
  const toHtml = (cell) => cell.trim().replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const [, mode, runs, waits] of rows) {
    assert.ok(html.includes(`<dd>${toHtml(runs)}</dd>`), `${mode}: runs without asking`);
    assert.ok(html.includes(`<dd>${toHtml(waits)}</dd>`), `${mode}: waits for approval`);
  }
  assert.match(html, /<input type="radio" name="permission-mode" id="mode-ask" value="ask" checked \/>/);
});

test('names no retired or upstream identities', () => {
  const html = renderLandingPage();
  const legacyToken = ['cloud', 'cli'].join('');
  const upstreamName = ['Claude', 'Code', 'UI'].join(' ');
  for (const source of [html, INDEX_HTML]) {
    assert.equal(source.toLowerCase().includes(legacyToken), false);
    assert.equal(source.includes(upstreamName), false);
    assert.equal(source.includes('Sol'), false, 'no case-sensitive "Sol" (catches Solid, Solution, Solo)');
    assert.equal(source.includes('Daymark'), false);
    assert.doesNotMatch(source, /AGPL/);
  }
});

test('lists film chapters as seek points only when the film provides them', () => {
  assert.equal(renderLandingPage().includes('film-chapters'), false);
  const html = renderLandingPage({ filmChapters: [{ t: 4.2, title: 'Pick the model. Set the depth.' }, { t: 71, title: 'Outro' }] });
  assert.match(html, /data-film-seek="4\.2"><span class="film-chapter-time">0:04<\/span><span>Pick the model\. Set the depth\.<\/span>/);
  assert.match(html, /<span class="film-chapter-time">1:11<\/span>/);
});

test('the film starts playing when its dialog opens, without waiting on metadata first', () => {
  // With preload="none", nothing loads until play() or load(), so gating play() on
  // loadedmetadata leaves the film on its poster forever.
  const open = MAIN_JS.slice(MAIN_JS.indexOf('function openFilm('), MAIN_JS.indexOf('function restoreLoops('));
  assert.ok(open.length > 0, 'openFilm exists');
  assert.match(open, /playFilm\(\)/);
  assert.doesNotMatch(open, /addEventListener\('loadedmetadata', start/);
  assert.match(MAIN_JS, /function playFilm\(\) \{\s*const attempt = filmVideo\.play\(\);/);
  // The current chapter is announced: aria-current="" would read as false.
  assert.match(MAIN_JS, /setAttribute\('aria-current', 'true'\)/);
  assert.doesNotMatch(MAIN_JS, /toggleAttribute\('aria-current'/);
});

test('the retired beta.7 screenshots no longer ship with the site', () => {
  assert.equal(existsSync(new URL('screenshots', PUBLIC_DIR)), false);
});

test('shows the DMG size and checksum only for the build they were measured on', () => {
  const facts = DMG_FACTS[RELEASE.version];
  assert.ok(facts, 'the checked-in release has file facts');
  const desktop = section(renderLandingPage(), 'download');
  assert.match(desktop, new RegExp(`DMG · ${Math.round(facts.bytes / 1e6)} MB`));
  assert.ok(desktop.includes(`<code>${facts.sha256}</code>`));
  const overridden = section(renderLandingPage({ release: { version: '9.9.9-test', tag: 'v9.9.9-test', publishedLabel: '2031-01-02' } }), 'download');
  assert.equal(overridden.includes(facts.sha256), false);
  assert.doesNotMatch(overridden, /DMG · \d+ MB/);
});

test('controls are hidden until enhanced, named apart, and scrollable code is focusable', () => {
  assert.match(STYLES, /\[hidden\] \{\s*display: none !important;/);
  const html = renderLandingPage();
  const names = [...html.matchAll(/data-media-toggle data-media-name="([^"]+)" hidden aria-label="Pause \1"/g)].map((m) => m[1]);
  assert.equal(names.length, [...html.matchAll(/data-media-toggle/g)].length, 'every toggle has a name');
  assert.equal(new Set(names).size, names.length, 'toggle names are distinct');
  for (const pre of html.match(/<pre\b[^>]*>/g)) {
    assert.match(pre, /tabindex="0" aria-label="[^"]+"/);
  }
  // The phone menu repeats every header link.
  const header = html.slice(html.indexOf('<header class="site-header"'), html.indexOf('</header>'));
  const menu = header.slice(header.indexOf('nav-menu-panel'));
  for (const href of ['#product', '#download']) {
    assert.ok(menu.includes(`href="${href}"`), href);
  }
});

test('ships no media or brand file that nothing references', () => {
  // A file counts as used when the rendered page, index.html or the site's own source names it
  // (prerender.js reads media/film/chapters.json at build time).
  const corpus = [renderLandingPage(), INDEX_HTML, ...SOURCES].join('\n');
  const allowed = new Map([
    // Media contract deliverable in the media lane: the JPEG twin of the hero poster the page
    // serves as WebP. Kept for the media contract, not linked.
    ['media/hero/hero-poster.jpg', 'contract deliverable'],
    // Tracked legacy art: the source the brand kit derives the mascot and wordmark from.
    ['brand/character.png', 'tracked source art'],
  ]);
  // An encoder's in-progress output (engine/build.mjs renames or removes it when it finishes).
  const inProgress = (path) => /\.tmp\./.test(path);
  const files = [...publicFiles('media'), ...publicFiles('brand')];
  assert.ok(files.length > 20, 'public/media and public/brand are listed');
  const unreferenced = files.filter((path) => !inProgress(path) && !allowed.has(path) && !corpus.includes(path));
  assert.deepEqual(unreferenced, [], 'every shipped media and brand file is used by the page');
  // The heavy PNG twins of the WebP brand art stay out of the site.
  for (const png of ['brand/mascot.png', 'brand/mascot-600.png', 'brand/wordmark-pixel.png', 'brand/wordmark-pixel-on-dark.png', 'brand/mark-192.png', 'brand/mark-512.png']) {
    assert.equal(existsSync(new URL(png, PUBLIC_DIR)), false, `${png} does not ship`);
  }
});

test('chapter clips share one wide sticky stage and fade through it one at a time', () => {
  const html = renderLandingPage();
  assert.equal((html.match(/<div class="chapter-stage" aria-hidden="true"><\/div>/g) ?? []).length, 1);
  // Legibility: the stage takes up to 840 px (0.81x of a 1040-px crop of the app) and the copy
  // column keeps at least 280 px, with its text held to a 36ch measure. Below 1200 px the
  // chapters stack, so the clip gets the full content width instead of a ~0.6x stage.
  assert.match(STYLES, /grid-template-columns: minmax\(var\(--copy-min\), 1fr\) min\(840px, calc\(100% - var\(--copy-min\) - var\(--chapter-gap\)\)\);/);
  assert.match(STYLES, /--stage-w: min\(840px,/);
  assert.match(STYLES, /@media \(min-width: 1200px\) \{\s*\.chapters\.is-enhanced \{/);
  assert.match(MAIN_JS, /matchMedia\('\(min-width: 1200px\)'\)/);
  assert.match(STYLES, /--copy-min: 280px;/);
  assert.match(STYLES, /\.chapters\.is-enhanced \.chapter-note \{\s*max-width: 36ch;/);
  // Fade-through: the outgoing clip is gone (0.18 s) before the incoming one starts rising.
  const inactive = STYLES.match(/\.chapters\.is-enhanced \.chapter-media \{[^}]*opacity: 0;[^}]*transition:\s*opacity ([\d.]+)s[^}]*\}/);
  const active = STYLES.match(/\.chapters\.is-enhanced \.chapter-media\.is-active \{[^}]*transition:\s*opacity [\d.]+s var\(--ease-out\) ([\d.]+)s/);
  assert.ok(inactive && active, 'both chapter-media transitions are declared');
  assert.ok(Number(active[1]) >= Number(inactive[1]), 'the incoming clip waits for the outgoing one to fade out');
  // The hero shows the whole app window at the container's width: 1200 / 1440 = 0.83x.
  assert.match(STYLES, /--container: 1200px;/);
});

test('bento tiles carry real stills and tell waiting and failed sessions apart', () => {
  const html = renderLandingPage();
  const bento = html.slice(html.indexOf('<div class="bento">'), html.indexOf('<div class="get" id="get">'));
  const shots = [...bento.matchAll(/<div class="shot[^"]*" style="--sx: (\d+); --sy: (\d+); --sw: (\d+); --sh: (\d+)/g)];
  assert.ok(shots.length >= 2, 'at least two tiles show a real still');
  for (const [, x, y, w, h] of shots) {
    assert.ok(Number(x) + Number(w) <= 1440 && Number(y) + Number(h) <= 900, 'crops stay inside the 1440x900 still');
  }
  assert.match(bento, /media\/stills\/sidebar-states-1440\.jpg/);
  // The app's own four state labels, in its priority order.
  const labels = [...bento.matchAll(/<li class="state state-([a-z-]+)"><span class="state-mark" aria-hidden="true">([\s\S]*?)<\/span><span>([^<]+)<\/span><\/li>/g)];
  assert.deepEqual(labels.map((match) => match[3]), [
    'Waiting for your input',
    'Run failed, not viewed yet',
    'Finished, not viewed yet',
    'Running',
  ]);
  const mark = (id) => labels.find((match) => match[1] === id)[2];
  assert.notEqual(mark('needs-input'), mark('blocked'), 'waiting and failed use different marks');
  assert.match(STYLES, /\.state-blocked \.state-mark \{\s*color: var\(--danger\);/);
  assert.match(STYLES, /\.state-needs-input \.state-mark \{\s*color: var\(--orange\);/);
  // Tile body copy never outranks the eyebrow or component rules (no !important needed).
  assert.match(STYLES, /\.tile :where\(p:not\(\.eyebrow\)\) \{/);
  assert.equal((STYLES.match(/!important;/g) ?? []).length, 1, 'only the [hidden] rule uses !important');
});

test('the active chapter follows the scroll position, not band crossings', () => {
  // A jump that skips a narrow band (scrollbar drag, End, find-in-page, restoration) must
  // still land on the right clip, so the chapter is derived from where the steps are.
  const body = MAIN_JS.slice(MAIN_JS.indexOf('function chapterInView('), MAIN_JS.indexOf('/* ---------- Reveal on scroll'));
  assert.match(body, /getBoundingClientRect\(\)\.top <= line/);
  assert.match(body, /window\.innerHeight \* 0\.5/);
  assert.match(body, /addEventListener\('scroll', scheduleChapterSync/);
  assert.match(body, /requestAnimationFrame/);
  assert.match(body, /applyLayout = \(\) => \{\s*if \(desktopChapters\.matches\) \{\s*setActiveChapter\(chapterInView\(\)/);
});

test('phones get tight stills of each chapter instead of a shrunken desktop clip', () => {
  const html = renderLandingPage();
  const figures = [...html.matchAll(/<figure class="chapter-media[^"]*" data-chapter-media="([a-z]+)">([\s\S]*?)<\/figure>/g)];
  assert.equal(figures.length, 6);
  for (const [, id, figure] of figures) {
    const crops = [...figure.matchAll(/<div class="shot[^"]*" style="--sx: (\d+); --sy: (\d+); --sw: (\d+); --sh: (\d+)/g)];
    assert.ok(crops.length >= 1, `${id} has a phone still`);
    for (const [, x, y, w, h] of crops) {
      // 0.8x or more on a ~360-px phone: at most ~450 CSS px of the app across.
      assert.ok(Number(w) <= 454, `${id} crop is at most 454 px wide`);
      assert.ok(Number(x) + Number(w) <= 1440 && Number(y) + Number(h) <= 900, `${id} crop is inside the still`);
    }
    assert.match(figure, /<img [^>]*alt="[^"]{20,}"/, `${id} still has alt text`);
  }
  assert.match(STYLES, /@media \(max-width: 767px\) \{\s*\.chapter-media \.media-frame,\s*\.chapter-media \.media-toggle \{\s*display: none;/);
  // The figure never redefines --focus (the focus-ring colour token).
  assert.doesNotMatch(html, /style="--focus:/);
});
