# Tauri Desktop (macOS arm64) — Verification Record

> **Status (2026-07-20): C7 complete, C8 void, C9 complete.** The interactive
> GUI smoke was executed end-to-end on the installed DMG build, driven through
> gjc computer use (screenshots, drive transcript, QA report, and re-drill logs
> under `artifacts/g002/`). Electron was removed in C9/wave1, which also voids
> the C8 Electron↔Tauri rollback drill. The only remaining human gate is
> **Developer ID signing + notarization** (below).

## Build the artifacts (on the Mac)

```sh
cd ~/workspace/gajae-app
npm ci
npm run server:payload:macos            # darwin-arm64 Node payload + externalBin
env -u CI npm run tauri -- build        # ad-hoc .app + DMG (bundle_dmg.sh needs a GUI session)
npm run desktop:dmg:macos               # headless functional DMG via hdiutil + sha256 (alternative)
```

Artifacts:
- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Gajae App_0.2.0_aarch64.dmg`
  (Tauri cleans the intermediate `.app` after bundling; install from the DMG.)

## C7 — Interactive GUI smoke — **PASSED 2026-07-20**

Executed against the DMG-installed `/Applications/Gajae App.app` at HEAD
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

## Remaining human gate — Developer ID signing + notarization

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
  --tauri-app "/Applications/Gajae App.app"

node scripts/release/smoke-packaged-server.mjs \
  --tauri-app "/Applications/Gajae App.app" --data-survival
```

The standard run verifies `/health` identity, one-time desktop bootstrap
(`HttpOnly` cookie + `303 /`), unauthenticated API denial, exact-Origin
authenticated API access, and a GJC job create/list/abort round trip against
an isolated temporary HOME/database. `--data-survival` adds the two-boot
durability drill (graceful shutdown → restart → gap-free replay, idempotent
migrations, resume). Both passed on the final C7 build
(`artifacts/g002/g002-packaged-smoke.log`).
