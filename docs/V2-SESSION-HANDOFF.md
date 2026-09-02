# gajae-app v2 — Session Handoff (resume state)

Last updated: 2026-09-02. Supersedes the 2026-07-18 handoff.

## TL;DR

- **The v2 baseline is complete.** Server/backend/web MVP (Slices 0–4 + 6), the Tauri
  desktop shell (Slice 5 C1–C6), **and the C7 interactive GUI smoke** are all
  done and verified. Electron is removed (C9/wave1); the C8 rollback drill is
  void (no rollback target; its data-survival axis is covered by the automated
  two-boot smoke, re-proven on the final build).
- **Post-v2 work has also landed.** Managed Chromium/CDP Development Preview
  landed in `b37bec7` (`src/components/workspace/view/BrowserPanel.tsx` and
  `server/modules/automation/browser-sidecar.ts`); context/token controls
  landed in `ac9b819`
  (`src/components/chat/view/subcomponents/ContextUsageBadge.tsx`). The
  2026-09-02 session-UI pass (tool output density, four-state session status,
  sidebar search, concise titles, per-project permissions) is recorded below.
- **Notarization remains human-gated, not the only repository work.** It still
  requires the Developer ID certificate + notarization credentials on the Mac;
  see `docs/DESKTOP-TAURI-VERIFICATION.md` § "Remaining human gate".
- v1 users are served by the frozen snapshot repo **`devswha/gajae-app-v1`**
  (cut at v1.0.0, release assets mirrored). Maintenance flows one way:
  this repo → cherry-pick to the snapshot.

## Working environment

- **This checkout is** `~/workspace/gajae-code-app` (repository guidance:
  `AGENTS.md`). Node via nvm
  (`. "$HOME/.nvm/nvm.sh" && nvm use 22`
  → 22.23.1 — `npm test` refuses other majors), cargo 1.85.1
  (`. "$HOME/.cargo/env"`). `env -u CI npm run tauri -- build` (the wrapper
  chokes on `CI=1`).
- Origin: `https://github.com/devswha/gajae-code-app`. The independent public
  history begins from the verified `2.0.0-beta.1` baseline.
- Commits use the repository hooks and must also pass `npm run verify`.

## 2026-07-19/20 session record (this run)

Ultragoal `.gjc/_session-019f7b3a-ad0b-7000-ba19-06c7d84a47b8/ultragoal/`
(goals.json + ledger.jsonl; receipts for every checkpoint):

| Goal | Scope | Status | Commits |
|---|---|---|---|
| G001 | Jobs UX slice close-out: createdAt/prompt threaded authority→UI; HEAD typecheck fix | superseded by G004 (work landed) | `1c53d6f` |
| G004 | Review blockers: 48 KiB byte-budgeted `job.list` + `nextCursor`; cursor-driven notification catch-up | ✅ complete | `8649ca5`, `4cf1dfa` |
| G002 | C7 GUI smoke via gjc computer use + 4 shell defect fixes | ✅ complete | `9bdc18d`, `60b26b6`, `ef6f076`, `2e584b9`, `36d7cb2` |
| G003 | This docs alignment pass | ✅ complete | (docs) |

Every complete checkpoint passed the full gate: ai-slop-cleaner PASS →
architect APPROVE (no CRITICAL/HIGH) → executor QA/red-team PASS →
`npm run verify` green → receipt in `ledger.jsonl`.

### What the C7 smoke found and fixed (all landed + re-drilled live)

1. `9bdc18d` — second instance crashed with SIGABRT inside
   `did_finish_launching` (setup error → `expect` panic → crash-reporter
   dialog); now exits 0 cleanly.
2. `60b26b6` — macOS Quit AppleEvents (Cmd-Q, `osascript quit`) bypass a
   preventable `ExitRequested` in this Tauri version, so quit orphaned the
   whole server tree; `RunEvent::Exit` now runs a bounded synchronous
   SIGTERM+wait shutdown fence. Verified: quit during a running job →
   whole tree exits, job `interrupted`, resumes cleanly.
3. `ef6f076` — a `ready` job (e.g. after abort) had no follow-up affordance;
   the job workspace now has one composer: `ready` → `/turns`,
   `interrupted` → `/resume` (`jobFollowUpKind` locked by tests).
4. `2e584b9` + `36d7cb2` — recovery Retry was a no-op (`__TAURI__` absent
   without `withGlobalTauri`, CSP-blocked inline handler) and deep links only
   focused the window (no IPC injection on the remote loopback origin).
   Retry now works; `gajae-app://open/job/<id>` navigates the SPA via
   Rust-validated pushState eval.

Evidence: `artifacts/g002/` (drive transcript, 17 validated screenshots,
QA report, packaged smoke logs, Gatekeeper log, leader evidence log) and
`artifacts/g001/` (API drill 13/13, e2e log).

### Closed app-owned advisories and open upstream issue

The app-owned 2026-07-20 advisories are closed as of 2026-07-25:

- ~~`/resume` HTTP route lacks the `resolveBinding` 409 ownership guard
  `/turns` has~~ — fixed; the guard and its test landed with the chat-parity
  commit.
- ~~Sidebar job badge can stay stale after an in-view resume~~ — moot. The
  jobs UI was removed (`src/components/jobs/` is empty; see
  `MainContentJobRemoval.test.tsx`), so there is no badge to go stale.
- ~~Unrouted `StandaloneShell`/`shell` components remain~~ — already deleted
  along with the xterm dependencies.

The remaining item is upstream, not an outstanding app advisory:

- gjc CLI `computer` tool: top-level `keys: string[]` is mangled by the tool
  bridge (batch-nested keypress works) and the key map has no modifier names,
  so Cmd-Q-style combos cannot be synthesized. Upstream gjc issue, still open;
  the quit contract was verified via the equivalent AppleEvent path.

## Release state (2026-09-01)

`v2.0.0-beta.6` is published at `205a226`; `main` has continued beyond that
tag. `v2.0.0-beta.4`
carried the 188 commits that had accumulated since beta.3 (React 19 + Compiler,
Tailwind 4, TanStack Query/Zustand split, GJC SDK 0.15.0 on Bun 1.4.0, in-app
OAuth login, the composer/model-picker overhaul, shared browser/CUA automation);
beta.5 followed the same day with the native-watcher fix below. Beta.6 followed
with the cross-origin transport protection. Post-beta.6 `main` includes the GJC
engine boundary and bundled-notice release work, the queued-message quota fix
(`8380a39`), and transcript-derived turn metadata (`bc1555f`, `1c13f69`).

Two things had quietly broken the release lane and were fixed as part of the
cut:

- `scripts/release/build-server-bundle.js` asserted an exact SDK version from a
  literal last touched at 0.11.8, so every dispatch after the runtime moved had
  failed. The pin now comes from `server/gjc-runtime-manifest.json`.
- The recursive native watcher missed transcripts a directory already held when
  it appeared (inotify emits the folder's creation before it registers the
  watch; a populated directory moved into a root is reported as one path). CI
  had been failing on it intermittently since 2026-08-27. Fixed in
  `native/gajae-core/src/watcher.rs` with a deterministic regression test.

The website (`https://devswha.github.io/gajae-code-app/`) deploys from `main`
and its advertised version is now asserted against the app's own, so a release
bump that forgets it fails the gate.

## 2026-09-02 dead-code and relicensing follow-up

A dead-code pass landed on `main`, then two fixes, then an unused-export
sweep. Net: ~7,760 lines removed, 4 dependencies dropped, `npm run verify`
green throughout.

- `7389741` — client: modules nothing imported after the workspace retirement
  and the wizard clone-flow removal (`SettingsMainTabs`, the GitHub-token hook
  with its clone API/types/url helpers, `HomeDirInput`, the empty-shell project
  constant, the time-ago formatter, legacy `useLocalStorage`), plus 407 locale
  keys per language no `t()` call could reach.
- `3663296` — server: `commandParser.js`, `frontmatter.ts`,
  `websocket-writer.service.ts`, `scripts/audit-policy.mjs`, a dead Playwright
  config entry.
- `c87a875` — server: the git endpoints orphaned by the git panel retirement.
- `8a23d70` — dependencies: `jszip`, `auto-changelog`, `autoprefixer`,
  `node-gyp` removed. `f71ed5b` — `browserslist` moved past two fresh high
  advisories.
- Browser smoke after the pass: the app came up clean; the one finding was the
  sidebar still polling a stale release repository for its version badge,
  fixed in `5de6248` (badge now reads `package.json` directly).
- `48ec3b6` — docs: `docs/UPSTREAM.md` names the upstream correctly
  ("Claude Code UI"); `docs/LICENSING.md` package count corrected to the
  measured 550. That rename tripped `check:identity`, which pinned the old
  provenance string — `36e1230` repoints the pin.
- `bb880e2` — unused-export sweep from knip (`npx knip --include exports,types`),
  every finding cross-checked with ripgrep across `src/`, `server/`,
  `shared/`, `scripts/`, `website/` and the bun test files: 59 files, ~80
  exports; locally-used symbols lost the `export` keyword, fully unreferenced
  symbols were deleted. Left alone on purpose: the `server/gjc-engine.ts`
  published surface, the `server/modules/*/index.ts` barrels (the boundary
  rule routes cross-module imports through them), `shared/productIdentity.js`
  (asserted by `check:identity`), exports referenced only by tests, and
  `DialogTrigger` (owns the Dialog focus-return plumbing).
- Residual overlap: `node scripts/measure-upstream-derivation.mjs` → 84 of
  91,711 lines (0.1%), `package.json` only. Unchanged by this work.

### 2026-09-02 afternoon: session UI and permissions

Prioritized from a comparison of session UIs (Cursor 3.x, Codex, Claude Code
and others) kept in the Cursor canvas `session-ui-comparison.canvas.tsx`,
outside the repo. Ten commits, `1825fb2`..`a4773ff`, all on `main`.

- `1825fb2` — chat: one three-level tool output density preference
  (compact / balanced / detailed, `toolOutputDensity.ts`) replaces the
  "Display reasoning" and "raw parameters" switches, which never reached the
  folds that decide a card's height. Compact folds every call into a row,
  detailed opens everything and never groups. Settings radio group, a header
  icon button that cycles it (⌘⇧D), three palette actions. `useUiPreferences`
  migrates v2→v3 once (either old switch on → detailed, else balanced; old
  keys kept for a release). Also fixed the bash group row showing "+N more"
  instead of the commands.
- `f7d2f3e` — found by browser smoke: a group containing a failed call
  unfolded itself at every level, so a session with many non-zero exits
  rendered the same wall of tracebacks in compact as in balanced. New
  `failureOpens` rule in the density table: only balanced/detailed unfold
  failures; compact keeps the error label/badge on the row and waits for a
  click.
- `ea285ba` — sidebar: four-state session status (running / needs_input /
  ready / blocked) derived by a pure function (`sessionStatusModel.ts`) from
  the run registry, open approval requests and the held last-run outcome;
  outcomes and last-viewed times persist in localStorage
  (`useSessionAttentionStore.ts`, `useSessionAttentionSync.ts` tracks
  approvals for every session, not just the visible one). Server:
  `/api/providers/sessions/running` gains `awaitingInput`, tracked by the run
  registry from the approval frames it already decorates. Work aggregates
  non-idle sessions needs_input > blocked > ready > running with per-state
  counts in the heading.
- `2f00b40` — sidebar: inline session search beneath New task, by title,
  project and message body (`useConversationMessageSearch`, the palette's
  server-side body search made callable across projects). 150 ms debounce,
  matching projects force-expanded while a query is active, `/` focuses the
  field from anywhere that is not a text field.
- `6340490` — sessions: `deriveSessionTitle` (`server/shared/utils.ts`) strips
  slash commands, @mentions, code fences and markdown, keeps the first
  sentence when it stands alone, cuts at 40 chars on a word boundary; the gjc
  indexer uses it for new transcripts and still never overwrites a stored
  name. "Regenerate title" (`POST /sessions/:id/regenerate-title`) is the one
  place a hand-written name is replaced. Finding: the runtime's
  `generateSessionTitle` (`utils/title-generator`, writes `header_patch
  {title, titleSource:'auto'}`) is wired only into the TUI input controller;
  the SDK session the worker drives never calls it. LLM titling would need a
  Protocol v1 event to carry the title back plus a title-source column in the
  DB. Deferred as a runtime capability to request.
- `558f05e` — an accessibility-tree smoke reported rows without a status
  attribute and a menu that did not open; neither reproduces (the tree cannot
  see `data-*`, an idle row has no indicator by design). Locked in
  `SidebarSessionItem.menu.dom.bun.test.tsx`: status marker, ActionMenu on
  click, keyboard and coordinate click.
- `858f1a3`, `a74dedf`, `aab0dd0` — permissions: per-project mode
  (ask / auto_edits / bypass) plus an "always allow" tool list in SQLite
  (`project_permissions`, `/api/projects/:id/permissions`), sent with every
  run inside the existing worker `run` payload (no new frames, see
  `GJC-LIVE-SPEC.md`). The Bun adapter calls `setSdkPermissionMode('prompt')`
  and `setSdkPermissionProvider(...)`; covered calls are approved in the
  worker with one transcript notice per tool per run, everything else becomes
  a permission card whose new third action "Always allow <tool>" is persisted
  before it reaches the worker. UI: composer picker (⌘⇧P), palette actions,
  read-only Status row, Settings → Permissions tab (projects deviating from
  default, revoke/reset), bypass drawn destructive and confirmed once per
  project. The localStorage `skipPermissions` flag is migrated to bypass for
  the open project and removed.
  **Important finding — goes into the beta.7 release notes:** the runtime's
  SDK permission gate defaulted to `"allow"`, so GJC sessions had never
  prompted for bash, eval or delete; `skipPermissions` was a dead flag. The
  default `ask` now really prompts, which existing users will notice.
- `a4773ff` — gjc: `worker.initialize` was bounded at 5 s, but the Bun worker
  bootstraps the SDK inside that request (model registry + online discovery,
  measured 4–8 s here). After a server restart every reconnecting tab's
  `oauth.status` started the worker, the bound SIGKILLed it mid-bootstrap,
  and tabs saw only "GJC worker failed." with an empty worker log. Now
  `DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000`, shutdown has its own 5 s bound,
  initialization failures are diagnosed in both logs, and a malformed
  `permissions` block is answered with `invalid_permissions` → "Invalid GJC
  run permissions." on the client.

## How to resume (next session)

1. **Notarization + DMG (needs the user):** requires the Developer ID
   certificate + notarytool credentials on the Mac. Follow
   `docs/DESKTOP-TAURI-VERIFICATION.md` § "Remaining human gate", rebuild,
   and re-run the packaged smokes + `spctl` (should flip to accepted). Every
   shipped DMG so far is ad-hoc signed and Gatekeeper-blocked.
2. **Cut `v2.0.0-beta.7`:** `package.json` already carries `2.0.0-beta.7` and
   `"license": "MIT"`; the tag does not exist yet. This is the first MIT
   distribution. CI runs `npm run verify` on Linux for Node 22 and 24 on every
   push; the release job verifies the `linux-x64` native closure when it
   builds the server bundle. The release notes must call out the permission
   default change (`858f1a3`, above): sessions that never asked now ask.
3. **Session-UI roadmap, remaining items in priority order** (items 1–3 of the
   comparison — density, status/search, permissions — landed 2026-09-02):
   - (4) Changes tab: a diff review pane for the session's edits with line
     comments that turn into an agent reply.
   - (5) Worktree isolation + run-location picker. Investigate GJC runtime
     worktree support first; do not build it app-side if the runtime owns it.
   - Small follow-ups: LLM session titles via a Protocol v1 event (see
     `6340490`); the sidebar renders its mobile and desktop trees together —
     branch on `isMobile`; hardcoded strings left in `SkillPicker`,
     `CommandPalette`, `PermissionRequestsBanner`, `PlanDisplay`; the
     ask-controller's `reject_always` answer is not exposed in the UI.

## Key gotchas

- `dist-native/`, `src-tauri/{target,binaries,resources/server-payload}`,
  `.gjc-worktrees/` are gitignored platform/runtime artifacts — never commit.
- Tauri cleans the bundled `.app` after building the DMG; install from the DMG
  (or use `npm run desktop:dmg:macos` for the headless variant).
- The packaged smoke isolates HOME/DB; it is safe to run while the installed
  app is running.
- `test:e2e:gjc` (7 wire tests) is a separate script from `npm test`.
