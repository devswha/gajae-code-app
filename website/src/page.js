import {
  APPLE_GATEKEEPER_HELP_URL,
  DOCS_INSTALL_URL,
  DOCS_SELF_HOST_URL,
  GAJAE_CODE_URL,
  ISSUES_URL,
  LICENSE_URL,
  PRODUCT_NAME,
  RELEASE,
  RELEASES_URL,
  REPOSITORY_URL,
  buildDownloads,
} from './releases.js';

/**
 * The Gajae Code SDK version bundled with the checked-in release (v2.0.0-beta.20).
 * Update it by hand when CHECKED_IN_RELEASE moves to a build with a new SDK pin.
 */
export const BUNDLED_SDK_VERSION = '0.17.6';

/** The release the footage and stills under public/media were recorded in. */
export const RECORDED_VERSION = '2.0.0-beta.20';

/**
 * Size and SHA-256 of the macOS DMG, from the published GitHub release (FACTS §5). They are
 * keyed by version so a deploy-time release override never shows another build's numbers.
 */
export const DMG_FACTS = {
  '2.0.0-beta.20': {
    bytes: 226987465,
    sha256: 'fd6584299843c81d0f5d436e3b6e5cdfba6daa9fe007e133bf4f806707cb7596',
  },
};

/** Media files, per the media contract. Paths are relative to website/public. */
export const MEDIA = {
  hero: {
    mp4: 'media/hero/hero-loop.mp4',
    webm: 'media/hero/hero-loop.webm',
    poster: 'media/hero/hero-poster.webp',
    width: 1920,
    height: 1200,
  },
  film: {
    mp4: 'media/film/gajae-code-app-film.mp4',
    poster: 'media/film/film-poster.webp',
    posterJpg: 'media/film/film-poster.jpg',
    width: 1920,
    height: 1080,
  },
};

function feature(id, width = 1600, height = 1000) {
  return {
    mp4: `media/features/${id}.mp4`,
    poster: `media/features/${id}-poster.webp`,
    width,
    height,
  };
}

const CHAPTERS = [
  {
    id: 'work',
    label: 'Live turn',
    title: 'Watch the work happen.',
    body: 'A turn’s reads, searches, edits and commands fold into one work block. While it runs, the row says what the agent is doing right now. When it finishes, one line sums up the turn.',
    readout: ['Worked for 28s', '5 files read', '1 search', '1 command', '3 edits'],
    note: 'The block never unfolds by itself, not even on failure. Its row carries the failed count.',
    media: feature('work'),
    phone: [
      { still: 'work-block', crop: [356, 146, 440, 132], fade: true, alt: 'The live work block at 1:1: “Thinking… · Reading tidepool/data/tides.csv:1-3”, then Read ×4, a Search and a Read row.' },
    ],
    alt: 'A live Gajae Code turn in the tidepool project: the prompt is sent, then the work block fills with file reads, a search and three edits.',
  },
  {
    id: 'permission',
    label: 'Permissions',
    title: 'Commands wait for you.',
    body: 'In the default Ask mode, a shell command stops the turn on a card. Allow it once, always allow it in this project, or deny it. The turn resumes where it paused.',
    readout: ['Permission required', 'Tool: bash'],
    note: 'A card answered in one window closes in every other.',
    media: feature('permission'),
    phone: [
      { still: 'permission', crop: [350, 626, 440, 88], fade: true, alt: 'The permission card: Permission required, Tool: bash, and the start of the python3 -m unittest command.' },
      { still: 'permission', crop: [948, 706, 440, 46], alt: 'Its buttons: Deny, Always deny bash, Always allow bash and Allow.' },
    ],
    alt: 'A turn paused on a Permission required card for a bash command that runs the tidepool tests. Allow is clicked, the tests pass and the work block folds to one line.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Read the diff. Reply in the composer.',
    body: 'Every edit carries its diff inline in the conversation, with the line counts on its row. Read what changed, then write the next instruction in the composer. The agent takes it as the next turn of the same session.',
    readout: ['edit / cli.py', '+17 −0'],
    media: feature('review'),
    phone: [
      { still: 'diff', crop: [384, 66, 440, 200], fade: true, alt: 'The inline diff for edit / cli.py: the import lines, with import json added.' },
    ],
    alt: 'The inline diff for cli.py, 17 lines added, in the conversation. Then the reply “Sort the tides by time before printing, in both formats.” is typed in the composer and sent.',
  },
  {
    id: 'model',
    label: 'Session controls',
    title: 'Match the model to the task.',
    body: 'Pick the provider, the model and the reasoning depth from one searchable picker, without leaving the session. A model chosen for a session stays with it. Models, presets and credentials come from your own Gajae Code install.',
    readout: ['Provider', 'Conversation model', 'Reasoning'],
    media: feature('model'),
    phone: [
      { still: 'model-picker', crop: [716, 110, 448, 364], alt: 'The model picker: Provider, Conversation model and Reasoning columns, with Anthropic Opus 5.5 checked.' },
    ],
    alt: 'The composer’s model picker open in three columns, Provider, Conversation model and Reasoning, with a model and the High reasoning level chosen.',
  },
  {
    id: 'worktree',
    label: 'Isolation',
    title: 'Isolated by default.',
    body: 'In a git repository, each new session runs in its own managed worktree, so your checkout stays as you left it. The agent sidebar reports the changes, the directory and the branch. Going back to the shared checkout is one click, set per project.',
    readout: ['Run location', 'Project · New worktree'],
    note: 'A run that would rewrite git state outside its own worktree asks first.',
    media: feature('worktree'),
    phone: [
      { still: 'worktree', crop: [1100, 8, 340, 188], alt: 'The agent sidebar’s Environment panel: Changes 4, the job-session worktree directory and its job branch.' },
    ],
    alt: 'The agent sidebar opens beside a finished turn. Its Environment panel shows a Changes count of 4, the session’s worktree directory and its branch.',
  },
  {
    id: 'states',
    label: 'Sessions',
    title: 'Every session, at a glance.',
    body: 'Running, waiting for your input, finished or failed and not viewed yet: each session shows its state. The Work section gathers what needs a look across every project, and the model names each session from its first message.',
    readout: ['Running', 'Waiting for your input'],
    media: feature('states'),
    phone: [
      { still: 'sidebar-states', crop: [0, 306, 288, 192], alt: 'The sidebar: the tidepool session running, and the Work section with pixel-press waiting for input above it.' },
    ],
    alt: 'The sidebar while a turn runs: the tidepool session is running and the pixel-press session is flagged as waiting for input.',
  },
];

const PERMISSION_MODES = [
  {
    id: 'ask',
    label: 'Ask',
    isDefault: true,
    line: 'Commands and destructive file changes wait for your approval.',
    runs: 'Reads, searches, and file writes and edits the runtime does not gate',
    waits:
      'Commands (<code>bash</code>, <code>eval</code>), file deletes and moves — everything the runtime gates',
  },
  {
    id: 'auto-edits',
    label: 'Auto-approve edits',
    line: 'File edits run without asking; commands still wait for approval.',
    runs:
      'The above, plus every file mutation (<code>edit</code>, <code>write</code>, <code>delete</code>, <code>move</code>)',
    waits: 'Commands',
  },
  {
    id: 'bypass',
    label: 'Bypass',
    line: 'Nothing asks. The agent runs any command in this project.',
    runs: 'Everything',
    waits: 'Nothing — for a scratch project you trust the agent with',
    footnote: 'Turning it on takes a one-time confirmation per project.',
  },
];

/**
 * The four session states, with the app's own labels (sidebar.json `status.*`) and the marks
 * the app gives them (SidebarSessionStatus.tsx): a circle alert in the primary colour for
 * waiting, a triangle alert in the destructive colour for failed, the unread dot alone for
 * finished and a spinner for running. Shape and colour both differ, so waiting and failed never
 * read as the same orange dot.
 */
const SESSION_STATES = [
  { id: 'needs-input', label: 'Waiting for your input', mark: 'circleAlert' },
  { id: 'blocked', label: 'Run failed, not viewed yet', mark: 'triangleAlert' },
  { id: 'ready', label: 'Finished, not viewed yet', mark: 'dot' },
  { id: 'running', label: 'Running', mark: 'spinner' },
];

const LANGUAGES = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['ko', '한국어'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['ja', '日本語'],
  ['ru', 'Русский'],
  ['de', 'Deutsch'],
  ['tr', 'Türkçe'],
  ['it', 'Italiano'],
];

const icons = {
  apple: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`,
  play: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>`,
  pause: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>`,
  arrow: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  external: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>`,
  down: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>`,
  copy: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>`,
  menu: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>`,
  close: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  github: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`,
  shield: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/></svg>`,
  scale: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 6a3 3 0 0 0 5 0L5 8zM19 8l-2.5 6a3 3 0 0 0 5 0L19 8z"/></svg>`,
  laptop: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>`,
  spinner: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="14" height="14" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>`,
  circleAlert: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`,
  triangleAlert: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg>`,
  cube: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>`,
};

function asset(path) {
  return `./${path}`;
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Pause/play for one loop. `name` tells the loops apart in a screen reader's control list. */
function mediaToggle(name, className = 'media-toggle') {
  return `<button class="${className}" type="button" data-media-toggle data-media-name="${name}" hidden aria-label="Pause ${name}">
            <span class="media-toggle-pause">${icons.pause}</span>
            <span class="media-toggle-play">${icons.play}</span>
          </button>`;
}

/**
 * A muted, looping clip. Posters above the fold load eagerly (`poster`). Posters further down
 * are lazy: main.js copies `data-poster` into `poster` as the clip nears the viewport, and a
 * <noscript> image stands in for it when scripts are off.
 */
function loopVideo(media, { label, className = 'loop-video', lazyPoster = true }) {
  const sources = [
    media.webm ? `<source src="${asset(media.webm)}" type="video/webm; codecs=av01.0.09M.08" />` : '',
    `<source src="${asset(media.mp4)}" type="video/mp4" />`,
  ].join('');
  const poster = lazyPoster ? `data-poster="${asset(media.poster)}"` : `poster="${asset(media.poster)}"`;
  const video = `<video class="${className}" muted playsinline loop preload="none" ${poster} width="${media.width}" height="${media.height}" aria-label="${label}" data-loop>${sources}</video>`;
  if (!lazyPoster) {
    return video;
  }
  return `${video}<noscript><img class="loop-fallback" src="${asset(media.poster)}" alt="" width="${media.width}" height="${media.height}" loading="lazy" decoding="async" /></noscript>`;
}

/**
 * A crop of a real still. `crop` is the region in the still's 1440-px CSS space; the image
 * scales with its box (container query units), so the region always fills the box. The box
 * never grows past `maxScale` times the app's real size, so a small crop never balloons, and
 * callers size the box so the UI stays at or above 0.8x its real size where it is shown.
 */
function shot(name, { alt, crop: [x, y, w, h], className = '', maxScale = 1.2 }) {
  const stills = `media/stills/${name}`;
  return `<div class="shot${className ? ` ${className}` : ''}" style="--sx: ${x}; --sy: ${y}; --sw: ${w}; --sh: ${h}; --shot-max: ${maxScale}">
                <picture>
                  <source type="image/webp" srcset="${asset(`${stills}-1440.webp`)} 1x, ${asset(`${stills}-2880.webp`)} 2x" />
                  <img src="${asset(`${stills}-1440.jpg`)}" alt="${alt}" width="1440" height="900" loading="lazy" decoding="async" />
                </picture>
              </div>`;
}

/** The separator trails the item before it, so a wrapped line never starts with a dot. */
function readout(parts) {
  return `<p class="readout" aria-label="${parts.join(', ')}">${parts
    .map(
      (part, index) =>
        `<span>${part}${index < parts.length - 1 ? '<span class="readout-sep" aria-hidden="true">·</span>' : ''}</span>`,
    )
    .join('')}</p>`;
}

function chapterCopy(chapter, index) {
  const number = String(index + 1).padStart(2, '0');
  return `
          <article class="chapter-copy" style="--row: ${index + 1}" data-chapter="${chapter.id}" aria-labelledby="chapter-${chapter.id}-title">
            <p class="eyebrow"><span class="eyebrow-index">${number}</span>${chapter.label}</p>
            <h3 id="chapter-${chapter.id}-title">${chapter.title}</h3>
            <p class="chapter-body">${chapter.body}</p>
            ${readout(chapter.readout)}
            ${chapter.note ? `<p class="chapter-note">${chapter.note}</p>` : ''}
          </article>
          <figure class="chapter-media${index === 0 ? ' is-active' : ''}" data-chapter-media="${chapter.id}">
            <div class="media-frame">
              ${loopVideo(chapter.media, { label: chapter.alt })}
            </div>
            ${mediaToggle(`the ${chapter.label.toLowerCase()} clip`)}
            <div class="chapter-stills">${chapter.phone
              .map((still) =>
                shot(still.still, { alt: still.alt, crop: still.crop, className: still.fade ? 'shot-fade-right' : '' }),
              )
              .join('')}
            </div>
          </figure>`;
}

function permissionModes() {
  const inputs = PERMISSION_MODES.map(
    (mode) => `
                <input type="radio" name="permission-mode" id="mode-${mode.id}" value="${mode.id}"${mode.isDefault ? ' checked' : ''} />
                <label for="mode-${mode.id}">${mode.label}</label>`,
  ).join('');
  const panels = PERMISSION_MODES.map(
    (mode) => `
              <div class="mode-panel" data-mode="${mode.id}">
                <p class="mode-line"><strong>${mode.label}${mode.isDefault ? ' <span class="mode-default">default</span>' : ''}</strong> ${mode.line}</p>
                <dl class="mode-table">
                  <div class="mode-runs"><dt>Runs without asking</dt><dd>${mode.runs}</dd></div>
                  <div class="mode-waits"><dt>Waits for approval</dt><dd>${mode.waits}</dd></div>
                </dl>
                ${mode.footnote ? `<p class="mode-footnote">${mode.footnote}</p>` : ''}
              </div>`,
  ).join('');
  return `
            <fieldset class="modes-switch">
              <legend class="sr-only">Permission mode</legend>
              <div class="modes-options">${inputs}
                <span class="modes-thumb" aria-hidden="true"></span>
              </div>
            </fieldset>
            <div class="mode-panels" aria-live="polite">${panels}
            </div>`;
}

function faqItem(question, answer) {
  return `
          <details class="faq">
            <summary><span>${question}</span><span class="faq-mark" aria-hidden="true"></span></summary>
            <div class="faq-answer"><p>${answer}</p></div>
          </details>`;
}

function filmChapterList(filmChapters) {
  if (!filmChapters.length) {
    return '';
  }
  return `
          <ol class="film-chapters" aria-label="Film chapters">${filmChapters
            .map(
              (chapter) => `
            <li><button type="button" data-film-seek="${chapter.t}"><span class="film-chapter-time">${formatTimestamp(chapter.t)}</span><span>${chapter.title}</span></button></li>`,
            )
            .join('')}
          </ol>`;
}

export function renderLandingPage({ release = RELEASE, filmChapters = [] } = {}) {
  const downloads = buildDownloads(release);
  const version = `v${release.version}`;
  const dmgFacts = DMG_FACTS[release.version] ?? null;

  return `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header" data-header>
      <div class="container header-inner">
        <a class="brand" href="#top" aria-label="${PRODUCT_NAME}, back to top">
          <img src="./brand/mark.svg" alt="" width="28" height="28" />
          <span>${PRODUCT_NAME}</span>
        </a>
        <nav class="nav" aria-label="Primary">
          <a class="nav-wide" href="#product">Product</a>
          <a class="nav-wide" href="#download">Download</a>
          <a href="${DOCS_SELF_HOST_URL}">Docs</a>
          <a href="${RELEASES_URL}">Changelog</a>
          <a href="${REPOSITORY_URL}">GitHub</a>
        </nav>
        <div class="header-actions">
          <a class="button button-small" href="#download">Download</a>
          <details class="nav-menu" data-nav-menu>
            <summary aria-label="Menu">${icons.menu}</summary>
            <nav class="nav-menu-panel" aria-label="Menu">
              <a href="#product">Product</a>
              <a href="#download">Download</a>
              <a href="${DOCS_SELF_HOST_URL}">Docs</a>
              <a href="${RELEASES_URL}">Changelog</a>
              <a href="${REPOSITORY_URL}">GitHub</a>
            </nav>
          </details>
        </div>
      </div>
    </header>

    <main id="main">
      <section class="hero" id="top" aria-labelledby="hero-title">
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="container hero-inner">
          <a class="release-pill" href="${downloads.tagUrl}">
            <span class="live-dot" aria-hidden="true"></span>
            <span>Public beta · ${version}</span>
            <span class="release-pill-date">${release.publishedLabel}</span>
          </a>
          <h1 id="hero-title">Run the agent.<br /><span class="h1-second">Watch the work.</span></h1>
          <div class="hero-row">
            <div class="hero-copy">
              <p class="lede">
                The desktop app for Gajae Code. Follow the work as it lands, approve the commands
                that matter, and read each diff before you reply, all on your own machine.
              </p>
              <div class="hero-links">
                <a class="quiet-link" href="${GAJAE_CODE_URL}">About Gajae Code</a>
                <a class="quiet-link" href="${REPOSITORY_URL}">Source code</a>
                <a class="quiet-link" href="#self-host">Server setup</a>
              </div>
            </div>
            <div class="hero-actions">
              <div class="cta-row">
                <a class="button button-primary" href="${downloads.macosArm64.href}" aria-describedby="macos-beta-notice">
                  ${icons.apple}
                  <span>Download for macOS</span>
                </a>
                <a class="button button-ghost" href="${asset(MEDIA.film.mp4)}" data-film-open aria-haspopup="dialog">
                  ${icons.play}
                  <span>Watch the film</span>
                </a>
              </div>
              <p class="platform-note" id="macos-beta-notice"><span>Apple Silicon</span> · <span>macOS 13+</span> · <span>Notarized by Apple</span></p>
            </div>
          </div>
        </div>
        <div class="container hero-stage">
          <figure class="window" data-reveal>
            <div class="window-media">
              ${loopVideo(MEDIA.hero, {
                label:
                  'Gajae Code App running a real Gajae Code turn: a prompt is sent, the work block fills, a bash command waits on a permission card, Allow is clicked and the tests pass.',
                className: 'hero-video',
                lazyPoster: false,
              })}
            </div>
            ${mediaToggle('the hero clip')}
            <figcaption class="window-caption">
              <span class="caption-dot" aria-hidden="true"></span>
              <span>A real session recorded in v${RECORDED_VERSION}, sped up where it waits. Only the pointer is redrawn.</span>
            </figcaption>
          </figure>
          <figure class="hero-phone">
            <div class="phone-frame">
              ${loopVideo(feature('phone', 780, 1688), {
                label:
                  'The web UI at phone width on a real session: Allow is tapped on a Permission required card, the tests run and the turn finishes.',
                className: 'hero-video hero-phone-video',
              })}
            </div>
            <div class="hero-phone-foot">
              <figcaption>
                <span class="caption-dot" aria-hidden="true"></span>
                <span>The web UI at phone width, in a real session recorded in v${RECORDED_VERSION}.</span>
              </figcaption>
              ${mediaToggle('the phone clip', 'media-toggle media-toggle-inline')}
            </div>
          </figure>
        </div>
      </section>

      <div class="proof">
        <ul class="container proof-list" aria-label="At a glance">
          <li>${icons.shield}<div><strong>Notarized by Apple</strong><span>Signed with a Developer ID</span></div></li>
          <li>${icons.scale}<div><strong>MIT License</strong><span>Open source on GitHub</span></div></li>
          <li>${icons.laptop}<div><strong>Runs on your machine</strong><span>Loopback by default, fails closed</span></div></li>
          <li>${icons.cube}<div><strong>Gajae Code SDK ${BUNDLED_SDK_VERSION}</strong><span>Bundled, in an isolated worker</span></div></li>
        </ul>
      </div>

      <section class="product" id="product" aria-labelledby="product-title">
        <div class="container">
          <header class="section-head" data-reveal>
            <p class="eyebrow">One real session</p>
            <h2 id="product-title">Every step of the turn, in plain view.</h2>
            <p class="section-lede">
              Every clip comes from the shipping app, following one real session in a small Python
              project: a <code>--json</code> flag, a test run, a review and a follow-up.
            </p>
          </header>
          <div class="chapters" style="--chapters: ${CHAPTERS.length}">
            <div class="chapter-stage" aria-hidden="true"></div>
            ${CHAPTERS.map(chapterCopy).join('')}
          </div>
        </div>
      </section>

      <section class="phone" id="phone" aria-labelledby="phone-title">
        <div class="container phone-inner">
          <div class="phone-copy" data-reveal>
            <p class="eyebrow">Web UI · self-hosted</p>
            <h2 id="phone-title">Approve from your phone.</h2>
            <p>
              The web UI works down to phone width, on the same live run. Tap Allow on the phone
              and the card closes in the desktop browser by itself; the turn carries on.
            </p>
            <p class="fine-print">
              Not out of the box: the server listens on loopback and fails closed. A phone reaches
              it only over a network path you set up to a server you run, such as a tailnet, a VPN
              or an SSH tunnel. Web mode has one owner and no sign-in, so that network is the boundary.
              <a class="quiet-link" href="${DOCS_SELF_HOST_URL}">Self-host guide</a>
            </p>
          </div>
          <div class="phones" data-reveal>
            <figure class="phone-frame phone-frame-main">
              ${loopVideo(feature('phone', 780, 1688), {
                label:
                  'The web UI at phone width on the same session: Allow is tapped on a Permission required card, the tests run and the turn finishes with the tides sorted by time.',
              })}
              ${mediaToggle('the phone section clip')}
            </figure>
            <figure class="phone-frame phone-frame-side">
              <picture>
                <source type="image/webp" srcset="${asset('media/stills/phone-drawer-780.webp')}" />
                <img src="${asset('media/stills/phone-drawer-780.jpg')}" alt="The sessions drawer at phone width, listing the demo projects and their sessions." width="780" height="1688" loading="lazy" decoding="async" />
              </picture>
            </figure>
          </div>
        </div>
      </section>

      <section class="film" id="film" aria-labelledby="film-title">
        <div class="container">
          <header class="film-head" data-reveal>
            <div class="film-head-title">
              <p class="eyebrow">The film</p>
              <h2 id="film-title">One session, start to finish.</h2>
            </div>
            <p class="film-head-meta">The same real session, cut together: picking a model, the live turn, the permission card, the diff, the reply and the phone. Silent, with on-screen titles.</p>
          </header>
          <a class="film-card" href="${asset(MEDIA.film.mp4)}" data-film-open aria-haspopup="dialog" data-reveal>
            <picture>
              <source type="image/webp" srcset="${asset(MEDIA.film.poster)}" />
              <img src="${asset(MEDIA.film.posterJpg)}" alt="" width="${MEDIA.film.width}" height="${MEDIA.film.height}" loading="lazy" decoding="async" />
            </picture>
            <span class="film-card-shade" aria-hidden="true"></span>
            <span class="film-card-play">
              <span class="play-disc">${icons.play}</span>
              <span class="play-label">Play the film</span>
            </span>
          </a>
        </div>
      </section>

      <section class="capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div class="container">
          <header class="section-head" data-reveal>
            <p class="eyebrow">Around the run</p>
            <h2 id="capabilities-title">The rest of the workbench.</h2>
          </header>
          <div class="bento">
            <article class="tile tile-modes" aria-labelledby="modes-title" data-reveal>
              <div class="tile-head">
                <p class="eyebrow">Permission modes</p>
                <h3 id="modes-title">Decide what waits for you, per project.</h3>
                <p>The runtime’s own gate defaults to allow; the app does not. Set the mode from the composer or Settings → Permissions. <strong>Always allow</strong> on a card adds that tool to the project’s list.</p>
              </div>
              ${permissionModes()}
            </article>

            <article class="tile tile-sessions" aria-labelledby="sessions-title" data-reveal>
              <p class="eyebrow">Sessions</p>
              <h3 id="sessions-title">A state on every session.</h3>
              ${shot('sidebar-states', {
                alt: 'The app’s sidebar: four workspaces, tidepool open with its running session, and the Work section listing a pixel-press session waiting for input above the running tidepool session.',
                crop: [0, 156, 288, 344],
                className: 'shot-sidebar',
                maxScale: 1,
              })}
              <ul class="state-list">
                ${SESSION_STATES.map(
                  (state) =>
                    `<li class="state state-${state.id}"><span class="state-mark" aria-hidden="true">${state.mark === 'dot' ? '<span class="state-dot"></span>' : icons[state.mark]}</span><span>${state.label}</span></li>`,
                ).join('')}
              </ul>
              <p>The Work section lists what needs a look across every project.</p>
            </article>

            <article class="tile tile-density" aria-labelledby="density-title" data-reveal>
              <p class="eyebrow">Output density</p>
              <h3 id="density-title">Compact, Balanced or Detailed.</h3>
              <div class="segmented" aria-hidden="true"><span>Compact</span><span class="is-on">Balanced</span><span>Detailed</span></div>
              ${shot('finished', {
                alt: 'A folded work block in the app: Worked for 28s, 5 files read, 1 search, 1 command, 3 edits.',
                crop: [352, 145, 372, 28],
              })}
              <p>Balanced is the default. Compact and Balanced fold the work into one block; Detailed shows every card and streams the reasoning live.</p>
            </article>

            <article class="tile tile-steer" aria-labelledby="steer-title" data-reveal>
              <p class="eyebrow">Mid-turn</p>
              <h3 id="steer-title">Stop, steer or queue.</h3>
              <dl class="turn-keys">
                <div><dt><kbd>Esc</kbd></dt><dd>Stops the run from anywhere in the window; while it runs, Send becomes Stop.</dd></div>
                <div><dt>Steer the active turn</dt><dd>A message typed mid-turn goes into the running turn.</dd></div>
                <div><dt>Queue another message</dt><dd>Or it waits until the run finishes. Enter queues.</dd></div>
              </dl>
            </article>

            <article class="tile tile-slash" aria-labelledby="slash-title" data-reveal>
              <p class="eyebrow">Slash commands</p>
              <h3 id="slash-title">The runtime’s own commands.</h3>
              <ul class="chips" aria-label="Examples">
                <li><code>/fast</code></li><li><code>/effort</code></li><li><code>/context</code></li><li><code>/compact</code></li>
              </ul>
              <p>They come from Gajae Code’s own command list, so the runtime handles them, not the app.</p>
            </article>

            <article class="tile tile-notify" aria-labelledby="notify-title" data-reveal>
              <p class="eyebrow">Notifications</p>
              <h3 id="notify-title">Know when a run needs you.</h3>
              <ol class="notify-stack">
                <li><strong>Approval needed</strong><span>a card is waiting on you</span></li>
                <li><strong>Run ended</strong><span>the turn finished</span></li>
                <li><strong>Run unsuccessful</strong><span>the turn failed</span></li>
              </ol>
              <p>macOS notifications from the desktop app, with an optional sound.</p>
            </article>

            <article class="tile tile-langs" aria-labelledby="langs-title" data-reveal>
              <p class="eyebrow">Languages</p>
              <h3 id="langs-title">Ten UI languages.</h3>
              <ul class="lang-list">
                ${LANGUAGES.map(([code, name]) => `<li lang="${code}">${name}</li>`).join('')}
              </ul>
            </article>

            <article class="tile tile-local" aria-labelledby="local-title" data-reveal>
              <div class="tile-head">
                <p class="eyebrow">Local by default</p>
                <h3 id="local-title">Your machine is the workspace.</h3>
              </div>
              <dl class="local-facts">
                <div><dt>Server</dt><dd>Listens on loopback and rejects cross-origin callers.</dd></div>
                <div><dt>App data</dt><dd>Kept on your disk, under <code>~/.gajae-app</code>.</dd></div>
                <div><dt>Transcripts</dt><dd>Stay in Gajae Code’s own session files.</dd></div>
                <div><dt>Prompts</dt><dd>Go to the model provider you choose.</dd></div>
              </dl>
            </article>
          </div>
        </div>
      </section>

      <div class="get" id="get">
        <div class="container">
          <header class="section-head section-head-center" data-reveal>
            <p class="eyebrow eyebrow-plain">${version} · ${release.publishedLabel}</p>
            <h2>Get Gajae Code App.</h2>
            <p class="section-lede">Versioned files from GitHub Releases, each with its own SHA-256 checksum.</p>
          </header>
          <div class="get-grid">
            <section class="download-card" id="download" aria-labelledby="download-title" data-reveal>
              <div class="download-card-top">
                <img class="download-icon" src="./brand/mark.svg" alt="" width="56" height="56" />
                <div>
                  <p class="eyebrow">Desktop app</p>
                  <h3 id="download-title">Download the desktop app</h3>
                  <p class="download-meta">macOS · Apple Silicon · macOS 13+</p>
                </div>
              </div>
              <div class="download-actions">
                <a class="button button-primary button-wide" href="${downloads.macosArm64.href}">${icons.down}<span>Download DMG</span></a>
                <a class="checksum-link" href="${downloads.macosArm64.checksumHref}" aria-label="SHA-256 for macOS DMG">SHA-256</a>
              </div>${dmgFacts ? `
              <dl class="file-facts">
                <div><dt>File</dt><dd>DMG · ${Math.round(dmgFacts.bytes / 1e6)} MB</dd></div>
                <div><dt>SHA-256</dt><dd><code>${dmgFacts.sha256}</code></dd></div>
              </dl>` : ''}
              <p class="download-foot">Signed with a Developer ID and notarized by Apple. <a class="quiet-link" href="#macos-install">First-launch instructions</a></p>
              <p class="availability">Intel Mac and Windows builds are not available.</p>
            </section>

            <section class="self-host-card" id="self-host" aria-labelledby="self-host-title" data-reveal>
              <p class="eyebrow">Web interface</p>
              <h3 id="self-host-title">Prefer the web interface?</h3>
              <p>Run the same app in your browser from a server you control, or from source. These are alternatives to the desktop app.</p>
              <div class="host-row">
                <div>
                  <h4>Linux server</h4>
                  <p>x86_64 · glibc 2.35+ · Requires Node.js 22.22.2+ (22.x)</p>
                </div>
                <div class="host-actions">
                  <a class="button button-secondary" href="${downloads.linuxServer.href}">${icons.down}<span>Download archive</span></a>
                  <a class="checksum-link" href="${downloads.linuxServer.checksumHref}" aria-label="SHA-256 for Linux server archive">SHA-256</a>
                </div>
              </div>
              <div class="code-block">
                <div class="code-head"><span>Reach it over an SSH tunnel</span><button class="copy-button" type="button" data-copy hidden>${icons.copy}<span>Copy</span></button></div>
                <pre tabindex="0" aria-label="SSH tunnel command"><code>ssh -N -L 3001:127.0.0.1:3001 user@server</code></pre>
              </div>
              <div class="host-row">
                <div>
                  <h4>Source</h4>
                  <p>Run the web interface locally from the repository.</p>
                </div>
                <div class="host-actions">
                  <a class="button button-secondary" href="${REPOSITORY_URL}">${icons.github}<span>View on GitHub</span></a>
                </div>
              </div>
              <p class="host-foot"><a class="quiet-link" href="${DOCS_SELF_HOST_URL}">Server installation guide</a></p>
            </section>
          </div>
        </div>
      </div>

      <section class="install" id="macos-install" aria-labelledby="install-title">
        <div class="container install-inner">
          <header class="install-head" data-reveal>
            <p class="eyebrow">First launch</p>
            <h2 id="install-title">Opening the app for the first time.</h2>
            <p>
              Since v2.0.0-beta.7 the DMG is signed with a Developer ID and notarized by Apple, so
              macOS opens it like any other app. Verify the download anyway; the checksum is
              published beside it.
            </p>
          </header>
          <ol class="steps" data-reveal>
            <li><span class="step-num" aria-hidden="true">1</span><p>Download the DMG and its SHA-256 file.</p></li>
            <li><span class="step-num" aria-hidden="true">2</span><p>Open the DMG and drag ${PRODUCT_NAME} to Applications.</p></li>
            <li><span class="step-num" aria-hidden="true">3</span><p>Open the app. Gatekeeper checks the notarization ticket and lets it run.</p></li>
            <li><span class="step-num" aria-hidden="true">4</span><p>Only a build older than beta.7 needs <strong>System Settings → Privacy &amp; Security</strong> → <strong>Open Anyway</strong>.</p></li>
          </ol>
          <div class="code-block verify-block" data-reveal>
            <div class="code-head"><span>Verify in Terminal</span><button class="copy-button" type="button" data-copy hidden>${icons.copy}<span>Copy</span></button></div>
            <pre tabindex="0" aria-label="Verify command"><code>cd ~/Downloads
${downloads.macosArm64.verifyCommand}</code></pre>
            <a class="quiet-link code-foot" href="${APPLE_GATEKEEPER_HELP_URL}">Apple’s Gatekeeper instructions ${icons.external}</a>
          </div>
        </div>
      </section>

      <section class="faq-section" id="faq" aria-labelledby="faq-title">
        <div class="container faq-inner">
          <header class="faq-head" data-reveal>
            <p class="eyebrow">FAQ</p>
            <h2 id="faq-title">Questions, answered.</h2>
          </header>
          <div class="faq-list" data-reveal>
            ${faqItem(
              'Is it free?',
              'Yes. Gajae Code App is open source under the MIT license. It does not include a model or subscription.',
            )}
            ${faqItem(
              'Where does it run?',
              'On your machine: the desktop app on a Mac, or the web UI on a Linux server you control. Project files and execution state stay on the host. Prompts and context go to the model provider you pick.',
            )}
            ${faqItem(
              'What does it support?',
              'Gajae Code. The app uses the models, presets, skills, and credentials configured in your Gajae Code installation, and you can sign in to providers from inside the app.',
            )}
            ${faqItem(
              'Do I need the desktop app?',
              `No. You can run the web UI from source or use the Linux server archive. See <a href="${DOCS_INSTALL_URL}">the install guide</a>.`,
            )}
            ${faqItem(
              'Can I use it from my phone?',
              'Through the web UI, yes, once your phone can reach the server over a trusted network path you set up, such as a tailnet, a VPN or an SSH tunnel. The server listens on loopback by default, so this is never open out of the box. There is no native mobile app.',
            )}
            ${faqItem(
              'Is it multi-user?',
              'No. Web mode has one owner and no sign-in: whoever reaches the server is the owner, so the network is the boundary.',
            )}
            ${faqItem(
              'Is there a Windows or Intel Mac build?',
              'No. The desktop app is built for Apple Silicon Macs only, and Windows is not planned. On Linux, use the server archive and the web UI.',
            )}
          </div>
        </div>
      </section>

      <section class="outro" id="outro" aria-labelledby="outro-title">
        <div class="outro-glow" aria-hidden="true"></div>
        <div class="container outro-inner" data-reveal>
          <picture class="outro-mascot">
            <source type="image/webp" srcset="./brand/mascot-600.webp 512w, ./brand/mascot.webp 1023w" sizes="(min-width: 768px) 240px, 180px" />
            <img src="./brand/mascot-600.webp" alt="The Gajae Code mascot: a pixel-art lobster in a straw hat with a green-eyed visor." width="512" height="600" loading="lazy" decoding="async" />
          </picture>
          <h2 id="outro-title">Signed. Notarized. Yours.</h2>
          <p>Run the agent. Watch the work. Keep everything on your machine.</p>
          <div class="outro-actions">
            <a class="button button-primary" href="#download">${icons.apple}<span>Get the macOS app</span></a>
            <a class="button button-ghost" href="#self-host"><span>Self-host the web UI</span>${icons.arrow}</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <img class="footer-wordmark" src="./brand/wordmark-pixel-on-dark.webp" alt="Gajae Code" width="1422" height="313" loading="lazy" decoding="async" />
          <p>${PRODUCT_NAME} · ${version} · MIT License</p>
        </div>
        <nav class="footer-links" aria-label="Footer">
          <a href="${GAJAE_CODE_URL}">Gajae Code</a>
          <a href="${DOCS_INSTALL_URL}">Install guide</a>
          <a href="${RELEASES_URL}">Releases</a>
          <a href="${LICENSE_URL}">License</a>
          <a href="${ISSUES_URL}">Issues</a>
          <a href="${REPOSITORY_URL}">GitHub</a>
        </nav>
      </div>
    </footer>

    <dialog class="film-dialog" id="film-dialog" aria-labelledby="film-dialog-title">
      <div class="film-dialog-inner">
        <div class="film-dialog-head">
          <h2 id="film-dialog-title">${PRODUCT_NAME}, the film</h2>
          <button class="dialog-close" type="button" data-film-close aria-label="Close the film">${icons.close}</button>
        </div>
        <div class="film-player">
          <video class="film-video" controls muted playsinline preload="none" data-poster="${asset(MEDIA.film.poster)}" width="${MEDIA.film.width}" height="${MEDIA.film.height}" data-film-src="${asset(MEDIA.film.mp4)}" aria-label="${PRODUCT_NAME} product film, silent, with on-screen captions"></video>
        </div>${filmChapterList(filmChapters)}
      </div>
    </dialog>
  `;
}
