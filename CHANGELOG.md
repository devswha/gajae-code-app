# Gajae Code App changelog

All notable changes to Gajae Code App are documented in this file. Current and
future desktop and server artifacts are published only through
[GitHub Releases](https://github.com/devswha/gajae-code-app/releases).

## 2.0.0-beta.8 (2026-09-03)

Same-day follow-up to beta.7, driven by first-install testing on a clean
account. The macOS image published with beta.7 said "damaged and can't be
opened" once installed; it was replaced, and the root cause is fixed here.

### Packaging

- **The beta.7 "damaged" image, explained and fixed.** The bundled runtime
  publishes a Hangul bin alias (`node_modules/.bin/가재씨`); hdiutil's default
  HFS+ image stores that name in NFD while the code signature sealed NFC, so
  the app that verified on its own mount failed the seal check once Finder
  copied it to /Applications. The payload builder now drops non-ASCII bin
  links and refuses any other non-ASCII path, the DMG is built as APFS, and
  the DMG builder, the CI smoke and the documented acceptance verify a copy
  taken out of the mount — the check that would have caught it.
- The release workflow can now sign, notarize and staple the image on the
  runner when the `release` environment carries the Developer ID secrets;
  without them it builds the ad-hoc image as before.
- README added; the website's media is replaced with screenshots of the
  current release, and its first-launch instructions reflect notarization.

### Desktop

- **Sign-in and other external links actually open in the packaged app.**
  The webview is the server's loopback origin, where neither Tauri IPC nor
  `window.open` reach the outside, so "Open sign-in link" did nothing. https
  links now travel through the sidecar (new `POST /api/system/open-url`), and
  every `target="_blank"` anchor routes the same way.
- A sign-in completed through an older attempt's link fails as a named state
  mismatch with a "use the link shown now" message instead of a generic
  error. The model is told it runs inside the app: no `gjc` CLI to invoke,
  no `~/.gjc` to hand-edit, that configuration lives in Settings.

### Browser tool

- With no app-managed Chromium, an agent browser call used to end in a bare
  error. The tool now asks through a card: download Chrome for Testing once
  and continue, or decline and hear where to install it later (Browser panel
  or Settings → Automation).

### Sessions and chat

- A model chosen for a new session stays with that session (first-turn pin);
  the global default no longer hijacks a resumed session.
- The model picker dims providers nobody has signed in to (with a sign-in
  hint), keeps a search field, and shows reasoning levels whenever the
  runtime can answer.
- A background session's stream deltas merge into one message — the
  "one or two words per line, scroll stuck" report on returning to a
  session.
- The Changes tab's Last-turn scope sees history that arrives after it
  opened, without a click.
- **Tasks tab**: the session's live todo list in the workspace panel.
- **Copy debug info** in the session menu: DB row, transcript tail and log
  tails in one paste, for bug reports.
- An empty workspace is one line and one action ("Add a project"); the Work
  section appears only when it has something to report; the primary button
  renders only with projects (no dead third copy of Add a project), and
  "New work item" on the fresh screen lands the cursor in the composer;
  the rails sit one tonal step below the stage.

## 2.0.0-beta.7 (2026-09-03)

The first release under the MIT license, and the first shipped as a
Developer ID-signed, notarized macOS image. Earlier betas stay under AGPL.

### License

- Gajae Code App is relicensed under MIT. Every file that still carried
  upstream-derived expression was rewritten first (`docs/RELICENSING.md`
  records the method and the measured residual), the bundled GJC engine has
  one published surface and no imports into the app, AGPL and EPL packages
  are excluded from what ships (`elkjs` is replaced by a first-party stub so
  the packaged worker still boots), and `THIRD-PARTY-NOTICES.md` carries the
  notices the remaining dependencies require.

### Permissions

- The default permission policy now asks. The runtime's SDK gate defaulted
  to `allow`, so `bash`, `eval` and deletes ran without a prompt; each
  project now has a persisted mode (Ask, Auto-approve edits, Bypass) and an
  always-allow list, both settable from the composer and from Settings →
  Permissions. Permission cards offer Always allow, and Always deny when the
  runtime offers it; an answer given in one tab closes the card in every
  other viewer.

### Sessions

- A new session is titled by the runtime's model from its first message, in
  the sidebar and the header while the first turn is still running. A name
  you type is never replaced by it; Regenerate title returns to the
  heuristic; `sessions.name_source` records which is which.
- Four-state session status (running, waiting for input, finished unviewed,
  failed) with unread tracking, a Work section that lists every non-idle
  session across projects, inline sidebar search, and the selected project
  restored after reload.
- Stop pressed before the session had finished starting used to be refused
  and the turn ran on; it now ends the run before its prompt. Deleting or
  archiving a session used to leave its row in the sidebar until reload.
- A new session started with the app default model on a warm worker could
  fail with "model could not be resolved"; the default role now refreshes
  the model catalog and retries.

### Chat

- A turn's tool activity folds into one work block with a live status row,
  and a three-level tool output density preference (compact, balanced,
  detailed). Streamed deltas no longer re-render the whole transcript.
- Stop button and Esc abort the running turn; a live run fans out to every
  socket viewing the session; a message sent mid-turn steers it.
- Tool results that stopped at a cap say so once, and structured tool details
  reach the client without restating the notice.

### Workspace

- The file tree, git panel and in-app code editor are gone. Files open in
  your own editor.
- A Changes tab reads the project's working tree as a diff (capped so one
  project cannot freeze the tab), with a Last-turn scope that shows the
  files the viewed session's last turn edited. Comments on diff lines
  collect into one review message for the composer; Cmd/Ctrl+Enter sends it.
  The runtime's `.gjc/_session-*` scratch is hidden from the list.

### Server

- Cross-origin callers are rejected on both the HTTP and WebSocket
  transports. Session storage is reaped without eating queued messages.
  Turn identity rides the normalized envelope, derived from the transcript.

### Packaging

- The macOS DMG is built, signed with a Developer ID, notarized and stapled,
  and accepted by Gatekeeper from the mounted image; the packaged smokes run
  against the image, never the build tree. Dependency notices are
  platform-independent and shipped with the payload.

## 2.0.0-beta.6 (2026-08-31)

### Runtime

- Bundled GJC runtime moves to SDK 0.15.6 (natives 0.15.6) with both platform
  closures refilled. The runtime advertises a new `/aside` command (Run the
  Aside CLI), which the app now routes to the runtime instead of the model.

### Packaging

- The macOS bundle is ready for Developer ID signing and notarization: every
  Mach-O inside it is signed (found by file format, so vendored binaries can no
  longer slip through unsigned), `bun` carries the library-validation exception
  it needs once the runtime is hardened, the pinned native closure is restamped
  after signing so the worker still starts, and the disk image is signed so it
  can carry a stapled ticket. Set `APPLE_SIGNING_IDENTITY` to use a real
  identity; unset, the build stays ad-hoc as before.

### Release lane

- Releases are announced by the job that publishes them. The previous
  notification workflow waited for an event that a token-created release never
  raises, so it had never run once.

## 2.0.0-beta.5 (2026-08-31)

### Fixes

- A session transcript written into a directory that had just appeared under a
  watched root could go unreported: a recursive watch covers a subdirectory only
  once the platform has registered it, and a populated directory moved into a
  root was reported as one path whose contents were never observed. Every
  directory an event names is now rescanned and the transcripts it holds are
  reported.
- The Linux server bundle took its exact GJC SDK pin from a literal that had
  gone stale at 0.11.8, so every release dispatch after the runtime moved to
  0.15.0 failed before staging anything. The pin now comes from the runtime
  manifest the server verifies at boot.
- The download page advertised the previous release; the version it shows is
  now checked against the app's own.

## 2.0.0-beta.4 (2026-08-31)

### Chat

- Reworked the composer: per-session model selection, a provider → model →
  reasoning cascade picker with grouping and search, and a toolbar that shows
  the active model, reasoning effort, working directory and context usage.
  The picker stays usable when the runtime catalog is unavailable, and a
  session now shows the model it will actually run.
- Follow-ups are queued instead of dropped: a message sent during a running
  turn is queued unless steering is explicit, several follow-ups can stack, and
  a steered message is never invisible while it is in flight.
- Slash commands are owned by the app, not forwarded to the model. TUI-only
  commands have app-native equivalents, `/model` opens the app picker,
  destructive commands ask for confirmation first, and builtin command output
  renders safely.
- Tool calls and their output render as one block, keyed by the names the
  runtime actually sends, with shell output reachable even when a call carries
  no arguments and computer batches reporting what they did.
- Transcript typography and layout: one typeface, a readable measure, 16px
  message body, a user bubble sized to what was typed, failures rendered at the
  size of a failure, and an agent question shown as a question instead of a
  permission prompt.
- Conversations export as Markdown from the sidebar; sessions can be pinned,
  bulk-archived when idle, and their actions gathered into one menu.

### Workspace and providers

- The right-hand tools fold into one tabbed, resizable panel with a Status tab
  that answers what the session is doing, and chat links open in the browser
  panel.
- Bundled GJC runtime moved to SDK 0.15.0 on Bun 1.4.0, with SDK automation
  tools adopted, worker settings reloaded from disk on every run, session-root
  and reasoning-effort plumbing fixed on resume, subscription models presented
  and synced correctly, and the failure reason for a failed run no longer lost.
- Added in-app OAuth provider login; a closed tab no longer cancels another
  client's login attempt.
- Shared browser and CUA automation with a hardened sidecar lifecycle: identity
  resolution, benign abort races, preview fitted to the panel, and CUA output
  that can no longer freeze the app.

### Appearance

- Interface-wide font size setting, with editor font sizing through a theme
  extension.
- Every app icon and the in-app mark now render from one artwork.
- Fixed surfaces fit the dynamic viewport on mobile browsers.

### Frontend platform

- React 19 with the React Compiler enabled; server state moved onto TanStack
  Query and shell UI state onto Zustand; migrated to Tailwind 4 (CSS-first,
  no `tailwind.config.js`).
- Bundle and startup work: one language ships instead of ten (main bundle
  530KB → 271KB), markdown highlighting through PrismLight (vendor-syntax
  620KB → 63KB), the dead Google Fonts load is gone, and release payloads ship
  without source maps.
- Dropped unused dependencies (`chokidar`, `dompurify`, `rehype-raw`), upgraded
  react-router to 7, and closed the fixable audit advisories.

### Fixes

- A failed `/api/projects` fetch no longer blanks the whole app.
- Session transcripts are no longer written to a directory the OS deletes, and
  rows whose transcript the OS already deleted are pruned.
- Chat no longer freezes on a second turn, and the message merge degrades
  instead of throwing on a message without an id.
- Sidebar and palette polish: the wordmark no longer truncates, an open session
  menu stays above the following rows, and the palette says which session is
  already open.

## 2.0.0-beta.3 (2026-07-22)

### Desktop identity and distribution

- Renamed the visible product and macOS application bundle to **Gajae Code
  App** while preserving the `gajae-app` package, CLI, data directory, URL
  scheme, bundle identifier, and release asset prefixes for compatibility.
- Reduced the embedded macOS payload by removing the duplicate Node
  distribution, installing only server runtime dependencies, and pruning
  non-runtime metadata. The canonical DMG now fails closed above 250 MiB.
- Hardened ad-hoc packaging with an inside-out native signature pass and added
  runtime loading checks for SQLite, PTY, Lightning CSS, Gajae native bindings,
  and the Bun worker before release.
- Fixed Add Project on a fresh install so an auto-discovered GJC workspace is
  promoted to an explicit project instead of returning an already-exists
  error, and made that origin change refresh the sidebar immediately.

## 2.0.0-beta.2 (2026-07-22)

### Desktop distribution

- Added a downloadable Apple Silicon macOS DMG and SHA-256 checksum to the
  canonical GitHub Release. The release workflow builds the embedded server,
  packages the Tauri app on an arm64 macOS runner, mounts the DMG, verifies its
  bundle identity and binaries, and runs the packaged-server smoke before
  publishing.
- Standardized the desktop artifact name as
  `gajae-app-desktop-<version>-macos-arm64.dmg`. The current beta is ad-hoc
  signed and not notarized, so Gatekeeper-clean distribution still requires an
  Apple Developer ID certificate and notarization credentials.

### Source development

- Made the test suite pass on macOS (arm64): temp-dir tests canonicalize
  `os.tmpdir()` before building expectations (macOS `/var` resolves to
  `/private/var`, which the containment and native-watcher code correctly
  returns), and the GJC session-watcher tests hold one referenced event-loop
  handle because the watcher service intentionally unrefs its internal timers.
  Product behavior is unchanged.

## 2.0.0-beta.1 (2026-07-22)

- Initialized the Gajae Code App 2.0 beta release line.

## 1.2.0 (2026-07-18)

- Completed self-host operation: the bundled tmux relay supports send, spawn, and kill without an external control tower; About displays the Tailscale HTTPS address as read-only; workspace-path completion accepts both home-relative and absolute paths.

## 1.1.0 (2026-07-17)

- Improved live-session control and visibility: provider-neutral GJC discovery, RUN/LIVE state badges, an initial-message editor for idle sessions, source-checkout self-update, working unauthenticated shell sockets, corrected transcript rendering and spawn paths, and a less intrusive mobile settings layout.

## 1.0.0 (2026-07-17)

### Release foundation

- Established the product's own `1.0.0` version line and the
  `gajae-app-server-<version>-linux-x64-node22.tar.gz` server artifact. The
  health endpoint reports the running server version; the desktop shell keeps
  an independent `desktopVersion`.

### Web interface

- Removed the floating quick-settings edge handle on mobile; it overlapped chat
  content on phones. Its toggles (show thinking, show raw parameters, send by
  Ctrl+Enter) are now also available under Settings → Appearance on every
  device, and voice remains under Settings → Voice.
- Fixed the chat pane staying on its "Continue your conversation" empty state
  even though the messages API had returned the transcript: the session store
  signals changes by re-rendering with a stable object identity, but the
  message window was memoized on that identity and never recomputed after the
  fetch landed. Live tmux views and session history now render their messages.
- Fixed "새 세션" spawn always failing with "작업 폴더는 홈 아래 실존 디렉터리만":
  the control tower resolves the spawn cwd with expanduser against its own
  process CWD, so the app now sends home-relative folders with an explicit
  `~/` prefix instead of a bare relative path.
- Fixed the 외부 CLI / Shell terminal rendering a black screen in no-login
  mode: the shell WebSocket URL builder required a client-side localStorage
  auth token that never exists under `GAJAE_AUTH=none`, so the socket was
  never even attempted. WebSocket authentication is server-side (auth cookie
  or implicit owner), so the client-side token gate is gone.
- '대기' (idle, pre-transcript) gjc sessions in the sidebar now take their
  first message directly from the UI: an inline composer relays it through the
  control tower's send, shows an explicit promotion-wait state, and the live
  poll promotes the row to LIVE once gjc opens its transcript. Send failures
  and a promotion that never materializes fail closed back to an editable
  composer with the reason.
- Live sessions whose transcript tail shows a turn in progress (assistant
  answering or tool loop running) now carry a green RUN badge instead of the
  blue LIVE badge, so a working agent is distinguishable from one waiting for
  input at a glance. Detection reads the same turn-terminator records the
  live-turn notification monitor keys off; when the state is undeterminable
  the badge stays LIVE (fail-safe).

### Authentication

- Login is no longer required by default (`GAJAE_AUTH=none`): every request and
  WebSocket upgrade acts as the single implicit owner account, and the login,
  registration, and setup screens are skipped. `GAJAE_AUTH=password` restores
  the original single-account JWT/cookie flow unchanged.
- The fail-closed exposure guard now refuses to start an unauthenticated server
  on a non-loopback bind; `GAJAE_ALLOW_UNAUTH_REMOTE=1` downgrades that to a
  loud warning for trusted private networks (VPN/tailnet). Loopback binds are
  unaffected.
- `/api/auth/login` and `/api/auth/register` return 404 while authentication is
  disabled; `/api/auth/status` reports the active `authMode`.

### Source development

- Added Node.js 24.15.0+ support for dependency installation, development,
  tests, and builds while retaining Node.js 22.22.2+ compatibility. Production
  server artifacts remain pinned to the Node.js 22 line.
- Completed GJC worker Checkpoints A and B: GJC CLI/SDK execution now runs
  behind one supervised Node/TypeScript Protocol v1 worker with strict bounded
  NDJSON, immutable run correlation, controlled-question mirroring, crash
  restart, explicit failure reporting, graceful drain, detached POSIX process
  groups, and atomic Windows kill-on-close Job Object ownership. Browser replay,
  persistence, and notifications remain application
  owned; Claude, Codex, Cursor, and OpenCode routing is unchanged.
- Started GJC Checkpoint C with a mandatory minimal Rust process host.
  GJC worker launches now follow application → `gajae-core` → Node worker while
  preserving Protocol v1 bytes, browser behavior, and existing application
  state ownership. Source verification builds/tests the pinned Rust toolchain;
  server artifacts include and smoke the native executable without requiring
  Rust on the installed host.
- Added the second Checkpoint C slice: GJC persisted and live transcript roots
  are now watched by a parent-owned native Rust process with strict bounded
  events, canonical target containment, queue limits, cancellable graceful drain,
  failure restart with GJC-only reconciliation, and no Node fallback. Existing
  TypeScript indexing/database/browser behavior and all non-GJC Chokidar watchers
  are unchanged.
- Added the next Checkpoint C slice: `gajae-core jobs` is the single in-memory
  job state-machine authority, with fenced owner leases, explicit transitions,
  crash reconciliation to `interrupted`, and ordered idempotent event replay.
  Persistence, PTY, Git/worktree, SQLite, Protocol v1, and React remain unchanged.
- Persisted the native job authority in a separate Rust-owned SQLite database
  using bundled SQLite and sequential fail-closed migrations. State, fenced
  lease generations, and ordered idempotent events survive core replacement;
  startup reconciles active jobs to `interrupted`. Node does not access this
  database, and Protocol v1 and React remain unchanged.
- Added a native single-child PTY lifecycle API with direct no-shell launch,
  bounded base64 input/output, validated resize, deterministic exit reporting,
  stdin-EOF cleanup, and explicit shutdown. The existing browser shell remains
  on its unchanged Node path for this incremental slice.

### Native server distribution and operations

- Established the Linux x86_64, glibc 2.35+, Node.js 22 server artifact:
  `gajae-app-server-<version>-linux-x64-node22.tar.gz`. Release builds now
  require a glibc 2.35 builder and audit the Rust core plus rebuilt native
  modules for GLIBC symbol compatibility before archiving.
- Established `~/.local/share/gajae-app` as the source-review checkout and
  `~/.gajae-app` as the runtime, release, and persistent-data root.
- Established the per-user `gajae-app.service`, atomic release cutover, and
  rollback guidance.
- Documented manual, selective upstream intake with attribution, legal,
  focused-test, and identity-scan requirements. Automated synchronization is
  prohibited.

Gajae Code App began as a fork of claudecodeui; release history before the fork remains recorded in that project.
