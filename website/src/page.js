import {
  DOWNLOADS,
  DOCS_INSTALL_URL,
  DOCS_SELF_HOST_URL,
  GAJAE_CODE_URL,
  ISSUES_URL,
  LICENSE_URL,
  PRODUCT_NAME,
  RELEASE,
  RELEASES_URL,
  REPOSITORY_URL,
} from './releases.js';

function appleIcon() {
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`;
}

function globeIcon() {
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>`;
}

function terminalIcon() {
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
}

function faqItem(question, answer, open = false) {
  return `
    <details class="faq"${open ? ' open' : ''}>
      <summary>
        <span class="faq-mark faq-plus">+</span>
        <span class="faq-mark faq-minus">−</span>
        ${question}
      </summary>
      <p>${answer}</p>
    </details>
  `;
}

export function renderLandingPage() {
  return `
    <div class="hero-shell">
      <div class="hero-inner">
        <header class="site-header">
          <a class="brand" href="#top">
            <img class="brand-mark" src="/icon-96.png" alt="" width="24" height="24" />
            <span>Gajae</span>
          </a>
          <nav class="nav" aria-label="Primary">
            <a href="#features">Features</a>
            <a href="#download">Download</a>
            <a href="${DOCS_SELF_HOST_URL}">Docs</a>
            <a href="${RELEASES_URL}">Changelog</a>
            <a href="${REPOSITORY_URL}">GitHub</a>
          </nav>
        </header>

        <section class="hero" id="top">
          <h1>Run Gajae Code<br />from your desk</h1>
          <p class="lede">
            A local-first workspace for Gajae Code. Projects, sessions, presets, and skills stay on your machine.
          </p>
          <div class="cta-block">
            <div class="cta-row">
              <a class="btn btn-primary" href="${DOWNLOADS.macosArm64.href}">
                ${appleIcon()}
                Download for Mac
              </a>
              <a class="btn btn-ghost" href="${REPOSITORY_URL}">
                ${globeIcon()}
                Source
              </a>
              <a class="btn btn-ghost icon-btn" href="${DOWNLOADS.linuxServer.href}" aria-label="Linux server archive">
                ${terminalIcon()}
              </a>
            </div>
            <a class="quiet-link all-options" href="#download">All download options</a>
            <div class="supports">
              <span>Supports</span>
              <span class="badge">Gajae Code</span>
              <span class="badge">Default</span>
              <span class="badge">Planner</span>
              <span class="badge">Executor</span>
              <span class="badge">Architect</span>
              <span class="badge">Critic</span>
            </div>
          </div>
        </section>
      </div>

      <div class="hero-shot-wrap">
        <div class="hero-shot">
          <img src="/screenshots/gajae-app-overview.jpg" alt="Gajae Code App workspace with sessions nested under a project" />
        </div>
      </div>
    </div>

    <div class="landing-content">
      <main class="content">
        <div class="stack">
          <section id="features">
            <div class="section-head">
              <h2>Works with your Gajae setup</h2>
              <p>The app does not sell a model or a subscription. It uses the accounts, presets, and skills already configured in Gajae Code.</p>
            </div>
            <div class="grid-5">
              <div class="panel">Projects</div>
              <div class="panel">Sessions</div>
              <div class="panel">Presets</div>
              <div class="panel">Skills</div>
              <div class="panel">Approvals</div>
            </div>
          </section>

          <section>
            <div class="section-head">
              <h2>One surface for the work</h2>
              <p>Expand a project, resume a session, switch a preset, and watch tools stream in the same conversation.</p>
            </div>
            <div class="grid-2">
              <figure class="shot-card">
                <img src="/screenshots/model-presets.jpg" alt="Agent preset picker" />
                <figcaption>Default, Planner, Executor, Architect, and Critic in one picker.</figcaption>
              </figure>
              <figure class="shot-card">
                <img src="/screenshots/skill-commands.jpg" alt="Skill command menu" />
                <figcaption>Search project, user, and bundled skills with /skill:.</figcaption>
              </figure>
            </div>
          </section>

          <section>
            <div class="section-head">
              <h2>Review, continue, ship</h2>
              <p>Start a task from the project row, keep files beside the chat, and leave execution state on the host.</p>
            </div>
            <div class="surface">
              <div class="chrome">
                <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
                <div class="address">gajae-app / test / New Session</div>
              </div>
              <div class="workflow">
                <div class="review">
                  <div class="review-head">
                    <span>Live timeline</span>
                    <span class="quiet-link">streaming</span>
                  </div>
                  <div class="file-list">
                    <div class="file-row"><code>src/auth/session.ts</code><span class="delta">+42</span></div>
                    <div class="file-row"><code>src/auth/middleware.ts</code><span class="delta">+18</span></div>
                    <div class="file-row"><code>tests/auth.test.ts</code><span class="delta">+31</span></div>
                  </div>
                </div>
                <div class="ship">
                  <div class="ship-head">
                    <span>Ready to continue</span>
                    <span class="ok">local</span>
                  </div>
                  <div class="ship-actions">
                    <span>Preset</span>
                    <span>Skill</span>
                    <span>Send</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="download">
            <div class="section-head">
              <h2>Download</h2>
              <p>v${RELEASE.version} · pinned GitHub Release artifacts with matching checksums.</p>
            </div>
            <div class="download-card">
              <div class="platform">
                <div class="platform-label">${appleIcon()} macOS</div>
                <div class="pills">
                  <a class="pill" href="${DOWNLOADS.macosArm64.href}">Apple Silicon</a>
                  <a class="pill" href="${DOWNLOADS.macosArm64.checksumHref}">Checksum</a>
                </div>
              </div>
              <div class="platform">
                <div class="platform-label">${terminalIcon()} Linux server</div>
                <div class="pills">
                  <a class="pill" href="${DOWNLOADS.linuxServer.href}">x86_64 Node 22</a>
                  <a class="pill" href="${DOWNLOADS.linuxServer.checksumHref}">Checksum</a>
                </div>
              </div>
              <div class="platform">
                <div class="platform-label">${globeIcon()} Source</div>
                <pre class="code">git clone ${REPOSITORY_URL}.git
cd gajae-code-app
npm ci && npm run dev</pre>
              </div>
            </div>
            <p class="note">
              Intel Mac, Windows, and Linux desktop builds are not packaged yet.
              Production installs should use the versioned files on
              <a class="plain-link" href="${RELEASES_URL}">GitHub Releases</a>,
              not a latest URL.
            </p>
          </section>

          <section>
            <div class="section-head">
              <h2>Install</h2>
              <p>Verify the checksum before opening the DMG or unpacking the server archive.</p>
            </div>
            <div class="grid-2">
              <article class="download-card">
                <h3>macOS</h3>
                <p>Apple Silicon, macOS 11+. The current beta DMG is ad-hoc signed and not notarized.</p>
                <pre class="code">cd ~/Downloads
curl -L -O ${DOWNLOADS.macosArm64.href}
curl -L -O ${DOWNLOADS.macosArm64.checksumHref}
${DOWNLOADS.macosArm64.verifyCommand}</pre>
              </article>
              <article class="download-card">
                <h3>Linux server</h3>
                <p>x86_64, glibc 2.35+, Node.js 22. Do not substitute a registry or container image.</p>
                <pre class="code">curl --fail -LO ${DOWNLOADS.linuxServer.href}
curl --fail -LO ${DOWNLOADS.linuxServer.checksumHref}
${DOWNLOADS.linuxServer.verifyCommand}</pre>
                <p class="docs-links">
                  <a class="plain-link" href="${DOCS_INSTALL_URL}">INSTALL.md</a>
                  ·
                  <a class="plain-link" href="${DOCS_SELF_HOST_URL}">SELF-HOST.md</a>
                </p>
              </article>
            </div>
          </section>

          <section id="faq">
            <div class="section-head">
              <h2>FAQ</h2>
            </div>
            <div class="faq-list">
              ${faqItem(
                'Is this free?',
                'Yes. Gajae Code App is open source under AGPL-3.0-or-later. It does not include an AI model or subscription. You need Gajae Code configured with your own credentials.',
                true,
              )}
              ${faqItem(
                'Does my code leave my machine?',
                'The app keeps project files and execution state on the host. Agents talk to their own APIs the same way they would from the CLI. This app does not upload your repository.',
              )}
              ${faqItem(
                'What agents does it support?',
                'Gajae Code only. This product line does not wrap Claude Code, Codex, OpenCode, or Cursor as separate providers.',
              )}
              ${faqItem(
                'Do I need the desktop app?',
                'No. You can run the web UI from source or install the Linux server archive. The desktop app is the Apple Silicon beta shell around the same local server.',
              )}
              ${faqItem(
                'Why might macOS block the first launch?',
                'The current beta DMG is ad-hoc signed and not Apple-notarized. Verify the checksum from GitHub Releases, then Control-click the app and choose Open.',
              )}
            </div>
          </section>

          <section class="sponsor">
            <p>${PRODUCT_NAME} is an independent open-source workspace for running Gajae Code on your own machine.</p>
            <p>Use the provider you already have, keep the files local, and keep the workflow portable between the desktop shell and the browser UI.</p>
            <p><a class="btn btn-ghost" href="${GAJAE_CODE_URL}">Gajae Code</a></p>
          </section>
        </div>
      </main>

      <footer class="site-footer">
        <div class="footer-grid">
          <div class="footer-col">
            <p>Product</p>
            <a href="#features">Features</a>
            <a href="#download">Download</a>
            <a href="${DOCS_SELF_HOST_URL}">Docs</a>
            <a href="${LICENSE_URL}">License</a>
          </div>
          <div class="footer-col">
            <p>Agent</p>
            <a href="${GAJAE_CODE_URL}">Gajae Code</a>
            <a href="${REPOSITORY_URL}">Desktop app</a>
          </div>
          <div class="footer-col">
            <p>Community</p>
            <a href="${REPOSITORY_URL}">GitHub</a>
            <a href="${ISSUES_URL}">Issues</a>
          </div>
          <div class="footer-col">
            <p>Download</p>
            <a href="${DOWNLOADS.macosArm64.href}">macOS</a>
            <a href="${DOWNLOADS.linuxServer.href}">Linux server</a>
            <a href="${RELEASES_URL}">All releases</a>
          </div>
        </div>
      </footer>
    </div>
  `;
}
