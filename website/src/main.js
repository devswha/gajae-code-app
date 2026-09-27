// Progressive enhancement only. The page is rendered into index.html at build time and is
// complete without this script: videos show their posters (a <noscript> image for the lazy
// ones), the film link opens the file, the permission-mode switch works through CSS and the
// phone menu is a native <details>.

const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// The sticky two-column chapters need room for a stage that shows the app at ~0.8x;
// below 1200 px the stacked layout gives the clip the full content width instead.
const desktopChapters = window.matchMedia('(min-width: 1200px)');

/** Data saver or a slow link: show posters and let the viewer opt in to motion. */
function constrainedNetwork() {
  const connection = navigator.connection;
  return Boolean(connection && (connection.saveData || /(?:^|-)(?:2g|3g)$/.test(connection.effectiveType ?? '')));
}

/* ---------- Loop videos: play only in view, never under reduced motion ---------- */

const loops = new Map();

function setToggleState(entry) {
  const { toggle, video } = entry;
  if (!toggle) return;
  const playing = !video.paused;
  const name = toggle.dataset.mediaName || 'video';
  toggle.dataset.state = playing ? 'playing' : 'paused';
  toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${name}`);
}

function wantsToPlay(entry) {
  const optIn = reducedMotion.matches || constrainedNetwork();
  return entry.visible && entry.eligible && !entry.userPaused && (!optIn || entry.userPlayed);
}

function sync(entry) {
  const { video } = entry;
  if (wantsToPlay(entry)) {
    if (video.paused) {
      const attempt = video.play();
      if (attempt) attempt.catch(() => setToggleState(entry));
    }
  } else if (!video.paused) {
    video.pause();
  }
  setToggleState(entry);
}

function registerLoop(video) {
  const frame = video.closest('figure') ?? video.parentElement;
  const toggle = frame?.querySelector('[data-media-toggle]') ?? null;
  // The hero clip starts as soon as a tenth of it shows, so it is already moving on first paint.
  const threshold = video.classList.contains('hero-video') ? 0.1 : 0.25;
  const entry = { video, toggle, threshold, visible: false, eligible: true, userPaused: false, userPlayed: false };
  loops.set(video, entry);
  video.addEventListener('play', () => setToggleState(entry));
  video.addEventListener('pause', () => setToggleState(entry));
  video.addEventListener('playing', () => frame?.classList.add('is-playing'));
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      if (video.paused) {
        entry.userPaused = false;
        entry.userPlayed = true;
      } else {
        entry.userPaused = true;
        entry.userPlayed = false;
      }
      sync(entry);
      if (entry.userPlayed && video.paused) {
        const attempt = video.play();
        if (attempt) attempt.catch(() => {});
      }
    });
  }
  setToggleState(entry);
  return entry;
}

const videoObserver = new IntersectionObserver(
  (records) => {
    for (const record of records) {
      const entry = loops.get(record.target);
      if (!entry) continue;
      entry.visible = record.isIntersecting && record.intersectionRatio >= entry.threshold;
      sync(entry);
    }
  },
  { threshold: [0, 0.1, 0.25, 0.6] },
);

/* Lazy posters: set `poster` from `data-poster` as a clip comes within ~1000 px of view. */
function loadPoster(video) {
  if (video.dataset.poster && !video.getAttribute('poster')) {
    video.setAttribute('poster', video.dataset.poster);
  }
}

const posterObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (records) => {
          for (const record of records) {
            if (!record.isIntersecting) continue;
            loadPoster(record.target);
            posterObserver.unobserve(record.target);
          }
        },
        { rootMargin: '1000px 0px' },
      )
    : null;

for (const video of document.querySelectorAll('video[data-loop]')) {
  registerLoop(video);
  videoObserver.observe(video);
  if (video.dataset.poster) {
    if (posterObserver) posterObserver.observe(video);
    else loadPoster(video);
  }
}

reducedMotion.addEventListener?.('change', () => loops.forEach(sync));
navigator.connection?.addEventListener?.('change', () => loops.forEach(sync));

/* ---------- Chapters: sticky media swaps with the step in view (desktop) ---------- */

const chapterCopies = [...document.querySelectorAll('.chapter-copy')];
const chapterMedia = new Map(
  [...document.querySelectorAll('[data-chapter-media]')].map((figure) => [figure.dataset.chapterMedia, figure]),
);

let activeChapterId = null;

function setActiveChapter(id) {
  const changed = id !== activeChapterId;
  activeChapterId = id;
  for (const copy of chapterCopies) {
    copy.classList.toggle('is-active', copy.dataset.chapter === id);
  }
  for (const [figureId, figure] of chapterMedia) {
    const active = figureId === id;
    figure.classList.toggle('is-active', active);
    const video = figure.querySelector('video');
    const entry = video && loops.get(video);
    if (entry) {
      entry.eligible = !desktopChapters.matches || active;
      if (active && changed && desktopChapters.matches && video.readyState > 0) {
        video.currentTime = 0;
      }
      sync(entry);
    }
  }
}

/**
 * The active chapter is the last step whose top has crossed the middle of the viewport
 * (the first step before any has). It is derived from the scroll position, never from
 * edge-triggered band crossings, so a jump that skips a band (a scrollbar drag, End/Home,
 * find-in-page, scroll restoration, an anchor, a fast flick) still lands on the right clip.
 */
function chapterInView() {
  const line = window.innerHeight * 0.5;
  let current = chapterCopies[0];
  for (const copy of chapterCopies) {
    if (copy.getBoundingClientRect().top <= line) current = copy;
    else break;
  }
  return current;
}

let chapterFrame = 0;
function scheduleChapterSync() {
  if (chapterFrame || !desktopChapters.matches) return;
  chapterFrame = window.requestAnimationFrame(() => {
    chapterFrame = 0;
    if (desktopChapters.matches) setActiveChapter(chapterInView().dataset.chapter);
  });
}

if (chapterCopies.length) {
  document.querySelector('.chapters')?.classList.add('is-enhanced');
  window.addEventListener('scroll', scheduleChapterSync, { passive: true });
  window.addEventListener('resize', scheduleChapterSync, { passive: true });
  // A cheap extra trigger (e.g. content above resizing without a scroll event).
  if ('IntersectionObserver' in window) {
    const chapterObserver = new IntersectionObserver(scheduleChapterSync, { rootMargin: '-45% 0px -45% 0px' });
    chapterCopies.forEach((copy) => chapterObserver.observe(copy));
  }

  const applyLayout = () => {
    if (desktopChapters.matches) {
      setActiveChapter(chapterInView().dataset.chapter);
    } else {
      chapterCopies.forEach((copy) => copy.classList.remove('is-active'));
      for (const figure of chapterMedia.values()) {
        const video = figure.querySelector('video');
        const entry = video && loops.get(video);
        if (entry) {
          entry.eligible = true;
          sync(entry);
        }
      }
    }
  };
  desktopChapters.addEventListener?.('change', applyLayout);
  applyLayout();
  // Scroll restoration on reload can land after this script runs.
  window.addEventListener('load', scheduleChapterSync, { once: true });
  window.addEventListener('pageshow', scheduleChapterSync);
}

/* ---------- Reveal on scroll ---------- */

const revealTargets = document.querySelectorAll('[data-reveal]');
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (record.isIntersecting) {
          record.target.classList.add('is-revealed');
          revealObserver.unobserve(record.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  revealTargets.forEach((target) => {
    const box = target.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      target.classList.add('is-revealed');
    } else {
      revealObserver.observe(target);
    }
  });
  root.classList.add('reveal-ready');
} else {
  revealTargets.forEach((target) => target.classList.add('is-revealed'));
}

/* ---------- Header: hairline once the page scrolls ---------- */

const header = document.querySelector('[data-header]');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ---------- Film dialog: loads the film only when opened ---------- */

const dialog = document.getElementById('film-dialog');
const filmVideo = dialog?.querySelector('video[data-film-src]');
let filmOpener = null;

/** Seeks once the duration is known. Before that, setting currentTime would be dropped. */
function seekFilm(t) {
  if (filmVideo.readyState >= 1) filmVideo.currentTime = t;
  else filmVideo.addEventListener('loadedmetadata', () => (filmVideo.currentTime = t), { once: true });
}

/**
 * play() itself starts the download, even on a preload="none" element; waiting for
 * `loadedmetadata` first would wait forever, because nothing loads until play() or load().
 */
function playFilm() {
  const attempt = filmVideo.play();
  if (attempt) attempt.catch(() => {});
}

/**
 * On a phone the 16:9 film would play at about 358x201 inside the dialog, too small to
 * read the app in it, so it goes full screen (iOS only offers webkitEnterFullscreen).
 * This runs inside the click that opened the dialog, which fullscreen requires.
 */
const smallScreen = window.matchMedia('(max-width: 767px), (pointer: coarse)');
function webkitFullscreen(video) {
  if (typeof video.webkitEnterFullscreen !== 'function') return;
  const enter = () => {
    try {
      video.webkitEnterFullscreen();
    } catch {
      // Full screen is a convenience; the film still plays in the dialog.
    }
  };
  // iOS refuses before the metadata is in.
  if (video.readyState >= 1) enter();
  else video.addEventListener('loadedmetadata', enter, { once: true });
}

function enterFullscreen(video) {
  if (typeof video.requestFullscreen === 'function') {
    video.requestFullscreen().catch(() => webkitFullscreen(video));
  } else {
    webkitFullscreen(video);
  }
}

function openFilm(opener, startAt = 0) {
  if (!dialog || !filmVideo || typeof dialog.showModal !== 'function') return false;
  filmOpener = opener ?? document.activeElement;
  if (!filmVideo.getAttribute('poster') && filmVideo.dataset.poster) {
    filmVideo.setAttribute('poster', filmVideo.dataset.poster);
  }
  if (!filmVideo.getAttribute('src')) {
    filmVideo.preload = 'auto';
    filmVideo.src = filmVideo.dataset.filmSrc;
  }
  loops.forEach((entry) => {
    entry.eligible = false;
    sync(entry);
  });
  dialog.showModal();
  root.classList.add('has-dialog');
  playFilm();
  if (startAt > 0) seekFilm(startAt);
  filmVideo.focus({ preventScroll: true });
  if (smallScreen.matches) enterFullscreen(filmVideo);
  return true;
}

function restoreLoops() {
  loops.forEach((entry) => {
    const figure = entry.video.closest('[data-chapter-media]');
    entry.eligible = !figure || !desktopChapters.matches || figure.classList.contains('is-active');
    sync(entry);
  });
}

if (dialog && filmVideo) {
  for (const opener of document.querySelectorAll('[data-film-open]')) {
    opener.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      if (openFilm(opener)) event.preventDefault();
    });
  }
  for (const seek of dialog.querySelectorAll('[data-film-seek]')) {
    seek.addEventListener('click', () => {
      const t = Number(seek.dataset.filmSeek);
      if (!Number.isFinite(t)) return;
      playFilm();
      seekFilm(t);
    });
  }
  dialog.querySelector('[data-film-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button, [href], video[controls], [tabindex]:not([tabindex="-1"])')].filter(
      (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0,
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  filmVideo.addEventListener('timeupdate', () => {
    const buttons = dialog.querySelectorAll('[data-film-seek]');
    let current = null;
    for (const button of buttons) {
      if (Number(button.dataset.filmSeek) <= filmVideo.currentTime + 0.25) current = button;
    }
    // aria-current="" means false to assistive tech, so write "true" explicitly.
    buttons.forEach((button) =>
      button === current ? button.setAttribute('aria-current', 'true') : button.removeAttribute('aria-current'),
    );
  });
  dialog.addEventListener('close', () => {
    filmVideo.pause();
    root.classList.remove('has-dialog');
    restoreLoops();
    if (filmOpener && typeof filmOpener.focus === 'function') {
      filmOpener.focus({ preventScroll: true });
    }
    filmOpener = null;
  });
}

/* ---------- Phone menu: close after a pick, on Esc and on an outside tap ---------- */

const navMenu = document.querySelector('[data-nav-menu]');
if (navMenu) {
  const summary = navMenu.querySelector('summary');
  const syncMenu = () => summary?.setAttribute('aria-expanded', String(navMenu.open));
  navMenu.addEventListener('toggle', syncMenu);
  syncMenu();
  navMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => (navMenu.open = false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navMenu.open) {
      navMenu.open = false;
      summary?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (navMenu.open && !navMenu.contains(event.target)) navMenu.open = false;
  });
}

/* ---------- Copy buttons on code blocks ---------- */

for (const button of document.querySelectorAll('[data-copy]')) {
  const code = button.closest('.code-block')?.querySelector('code');
  if (!code || !navigator.clipboard) continue;
  button.hidden = false;
  const label = button.querySelector('span');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      label.textContent = 'Copied';
      button.classList.add('is-done');
    } catch {
      label.textContent = 'Press ⌘C';
    }
    window.setTimeout(() => {
      label.textContent = 'Copy';
      button.classList.remove('is-done');
    }, 1800);
  });
}

/* ---------- Pointer light on tiles ---------- */

if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  for (const tile of document.querySelectorAll('.tile, .download-card, .self-host-card')) {
    tile.addEventListener('pointermove', (event) => {
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${event.clientX - box.left}px`);
      tile.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  }
}
