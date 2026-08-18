# Tauri Desktop (macOS arm64) — Verification Record

> **Status (2026-07-22): beta.3 rename and reinstall QA passed; C7
> complete, C8 void, C9 complete.** The beta.3 installed-app smoke covered the
> visible rename, project/session navigation, preset and skill-command UI,
> task abort/resume, and quit/relaunch persistence. The interactive
> GUI smoke was executed end-to-end on the installed DMG build, driven through
> gjc computer use (screenshots, drive transcript, QA report, and re-drill logs
> under `artifacts/g002/`). Electron was removed in C9/wave1, which also voids
> the C8 Electron↔Tauri rollback drill. The only remaining human gate is
> **Developer ID signing + notarization** (below).

## Build the artifacts (on the Mac)

```sh
cd ~/workspace/gajae-code-app
npm ci
npm run server:payload:macos            # darwin-arm64 Node payload + externalBin
env -u CI npm run tauri -- build --bundles app # ad-hoc .app bundle
npm run desktop:dmg:macos               # headless functional DMG via hdiutil + sha256
```

Artifacts:
- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg`
- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg.sha256`

The `Release Gajae Code App` GitHub Actions workflow performs the same build,
mount, nested-signature, architecture, bundle-version, native-closure, and
packaged-server smoke checks before attaching both files to the versioned
GitHub Release. The DMG build fails if it exceeds 250 MiB.

Final local beta.3 candidate:

- Size: `235611893` bytes (224.7 MiB)
- SHA-256: `c185e65228587c3b0e87039bd205c22ea400e78fdcb5dac53a6477b8591a26e1`
- Installed bundle: `/Applications/Gajae Code App.app`, desktop version `0.2.2`
- Deep code-signature verification and packaged native/Bun loading smoke: pass

## Post-beta.3 HEAD — Rebuild and packaged-server smoke — **PASSED 2026-08-18**

Ran because the installed `/Applications` bundle had drifted: built 2026-07-25
carrying GJC SDK 0.11.8, while HEAD had moved 40 commits and three SDK minors
ahead (0.14.0). Nothing shipped since beta.3 — the Workspace panel, Status tab,
the message queue, steering — existed in any desktop build.

Verified on darwin-arm64 at `10cbb6e`:

- `npm run server:payload:macos` — payload built, signed, and pruned (364 MB).
- `npm run tauri -- build --bundles app` — bundle produced. Note: the tauri CLI
  rejects `CI=1` (`invalid value '1' for '--ci'`); build with `env -u CI`.
- Payload manifest pins `gjcSdk`/`natives` `0.14.0`, matching the repo.
- `npm run smoke:packaged-server -- --tauri-app <app>` — packaged server reported
  `{"status":"ok","product":"gajae-app","protocolVersion":1}`.
- Launched bundle runs three processes: desktop shell, packaged server on a
  loopback port, and the `gajae-core` session watcher.
- The packaged client bundle carries this session's work: `chat.steer`,
  `workspace-panel`, `statusTab`, and `queued_message_` all present in
  `dist/assets`.

Not covered: on-screen interaction. A `computer` screenshot returned an all-black
frame (locked display or missing Screen Recording permission), so the window's
rendered state was confirmed through the served bundle rather than visually.

Not done: the freshly built app was NOT installed over `/Applications`. Until it
is, the desktop a user launches remains the 2026-07-25 / SDK 0.11.8 build.

## beta.3 — Rename and reinstall smoke — **PASSED 2026-07-22**

The previous `/Applications/Gajae App.app` and `~/.gajae-app` were moved to
Trash without emptying it. The final beta.3 DMG was installed through Finder
and exercised through Computer Use against a fresh data directory.

- [x] Every visible app, window, and menu identity is **Gajae Code App**.
- [x] The explicit `gajae-app` project survives relaunch, and its compact
      sessions expand directly beneath the project instead of being duplicated
      in Work while idle.
- [x] Model preset selection exposes built-in and custom presets, each with the
      default agent plus Planner, Executor, Architect, and Critic roles.
- [x] Typing `/` exposes the installed `/skill:adaptive-response` command.
- [x] A running task appears in Work, abort removes it, and reopening the same
      session after quit/relaunch accepts a follow-up and returns `QA_RESUMED`.
- [x] The fresh database promoted the auto-discovered project to `origin =
      'explicit'`; no prior `~/.gajae-app` database was restored.
- [x] No new Gajae Code App crash report or `Code Signature Invalid` event was
      created after the baseline timestamp.

The local DMG did not carry a quarantine attribute, so macOS did not show the
expected first-run Gatekeeper warning on this Mac. Cross-Mac QA must download
the GitHub Release asset so quarantine is applied and separately verify the
right-click **Open** flow. This does not change the expected `spctl` rejection
for the intentionally ad-hoc beta.

## C7 — Interactive GUI smoke — **PASSED 2026-07-20**

Executed against the then-named DMG install `/Applications/Gajae App.app` at HEAD
`36d7cb2`, driven exclusively through gjc computer use. Evidence:
`artifacts/g002/g002-gui-drive-transcript.{md,json}`, screenshots `00`–`16`,
`g002-qa-report.json`, `g002-packaged-smoke.log`, `g002-leader-evidence.log`.

- [x] **Launch**: DMG mount (hdiutil checksums verified) → drag-install →
      launch; one sidecar tree, loopback ephemeral port, key bootstrap,
      `/health` identity, React UI (not recovery). (screenshot 01)
- [x] **Job (GJC web execution)**: create job → live human-readable timeline →
      diff (`+C7-SMOKE-OK`) → commit `7142761` landed in the smoke target
      repository's managed worktree (`~/gjc-c7-test`, not this repo); sidebar
      rows show the live prompt snippet and relative `createdAt`.
      (screenshots 02–07)
- [x] **Abort**: mid-stream abort → terminal event `jobState=aborted`, durable
      run `aborted/aborted`, job returns to `ready`. (screenshots 08–09)
- [x] **Resume / follow-up**: interrupted job shows the follow-up composer →
      Resume streams a new run to completion; `ready` jobs take a next turn via
      `/turns` (composer added by ef6f076 after the smoke exposed the gap).
      (screenshots 10–11)
- [x] **Editor**: Files panel opens `README.md` and renders its content.
      (screenshot 16)
- [x] ~~**Terminal**~~ — **N/A by design.** The Shell/Git/Files tabs were
      deliberately removed on 2026-07-11 (see the comment at
      `src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx:22`);
      the current product has no user-facing terminal surface.
- [x] **Window close keeps job alive**: red-button close hides the window; the
      sidecar tree survives and the running job completes while hidden; Dock
      reopen restores the window and timeline. (screenshot 12 + DB evidence)
- [x] **Quit graceful → interrupted**: quitting with a running job drives the
      shutdown fence — whole tree exits, durable state `interrupted`, and the
      job resumes cleanly on next launch. Verified through the macOS Quit
      AppleEvent, the same `applicationShouldTerminate` path Cmd-Q takes
      (unified-log evidence). A literal Cmd-Q keystroke could not be
      synthesized: the gjc `computer` keypress map has no modifier key names
      (root-caused, ledger-recorded; no fallback tooling was substituted).
- [x] **Deep link**: `open "gajae-app://open/job/<id>"` focuses the window and
      navigates the SPA to `/jobs/<id>` (Rust-validated id, pushState eval;
      36d7cb2). Malformed/foreign/traversal URLs are rejected by both the Rust
      and TS validators. (screenshot 13)
- [x] **Recovery/Retry**: SIGKILL of the sidecar shows the diagnostic recovery
      page; Retry (CSP-safe listener + `withGlobalTauri`, 2e584b9) respawns the
      sidecar and restores the React UI. (screenshots 14–15)
- [x] **Single instance**: a second launch exits cleanly (no SIGABRT
      crash-reporter dialog; 9bdc18d) and the running instance keeps focus.
- [x] **Gatekeeper**: `spctl --assess` rejects the ad-hoc build — the expected
      pre-notarization state (`g002-gatekeeper.log`).

Defects found and fixed by this smoke: `9bdc18d` (second-instance SIGABRT),
`60b26b6` (macOS Quit AppleEvent orphaned the server tree), `ef6f076` (no
follow-up affordance for `ready` jobs), `2e584b9` + `36d7cb2` (dead recovery
Retry; deep links did not navigate).

## C8 — Electron ↔ Tauri rollback drill — **VOID**

Electron was removed in C9/wave1 (`285ddea`), so there is no rollback target.
The drill's data-survival axis is covered continuously by the automated
two-boot cross-restart smoke below (rerun on the final build: PASS, gap-free
replay, idempotent schemas).

## C9 — Electron removal — **DONE (wave1, `285ddea`)**

`electron/`, `prepare-desktop-app.js`, Electron scripts/config and deps are
gone; the Windows Job Object code is retained. `npm run verify` and the mac
cargo/DMG/smoke lanes are green on the Tauri-only tree.

## Deferred public-distribution gate — Developer ID signing + notarization

This gate is intentionally deferred until beta.3 functional QA is complete and
the product owner explicitly decides to continue public distribution. See
Phase 7 in `docs/V2-PLAN.md` for the ordered readiness checklist.

The Mac has no Developer ID certificate and no notarization credentials
(`security find-identity -v -p codesigning` → 0 valid; `xcrun notarytool
history` → "Must provide credentials"). Ad-hoc signing is the current bar.

To ship a Gatekeeper-clean (notarized) DMG, provide on the Mac:
- A **Developer ID Application** certificate in the login keychain.
- Notarization creds: either a `xcrun notarytool store-credentials` profile, or
  `APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_PATH`.

Then set `src-tauri/tauri.conf.json` `bundle.macOS.signingIdentity` to the
Developer ID identity and export the notarization env before
`npm run tauri -- build`; Tauri signs, notarizes, and staples.

## Automated packaged-server smoke (Mac)

```sh
node scripts/release/smoke-packaged-server.mjs \
  --tauri-app "/Applications/Gajae Code App.app"

node scripts/release/smoke-packaged-server.mjs \
  --tauri-app "/Applications/Gajae Code App.app" --data-survival
```

The standard run verifies `/health` identity, one-time desktop bootstrap
(`HttpOnly` cookie + `303 /`), unauthenticated API denial, exact-Origin
authenticated API access, and a GJC job create/list/abort round trip against
an isolated temporary HOME/database. `--data-survival` adds the two-boot
durability drill (graceful shutdown → restart → gap-free replay, idempotent
migrations, resume). Both passed on the final C7 build
(`artifacts/g002/g002-packaged-smoke.log`).
