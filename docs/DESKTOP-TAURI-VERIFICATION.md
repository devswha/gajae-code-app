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

## Post-beta.3 HEAD — Transparent vector mark — **PASSED 2026-08-19 (00:42)**

Rebuilt and reinstalled at `91fe458`, carrying the uploaded transparent vector:
the in-app mark is now `mark.svg` with its own hat underside filled, and the six
plated `logo*.png` files are gone. Verified in the installed bundle:
`dist/mark.svg` hashes identically to the repository's and `dist/logo*.png`
returns nothing. Packaged-server smoke passed, signature verification passed,
and the app relaunched with its three processes.

Note: requesting `/mark.svg` from the packaged server over loopback answers 401
— it authenticates static assets too — so asset checks compare files inside the
bundle rather than HTTP responses.

## Post-beta.3 HEAD — Reframed icon — **PASSED 2026-08-18 (night)**

Rebuilt and reinstalled at `6949f86`, where the icon artwork was reframed 26%
larger and lower so the mark fills its tile. Signature verification passes, the
app relaunches with its three processes, and the bundled `dist/logo.png` hashes
identically to the repository's. Note that comparing an installed `.icns` to the
source PNG by hash is meaningless — `iconutil` re-encodes on extraction — so the
icon itself was confirmed by rendering it at 16 and 32px.

## Post-beta.3 HEAD — In-app mark rebuild — **PASSED 2026-08-18 (late evening)**

Rebuilt and reinstalled at `99bed13` after the icon generator was extended to
cover `public/logo*.png`. The bundled `dist/logo.png` now hashes identically to
the repository's, so the sidebar header, loading screen and gjc chat mark carry
the same artwork as the Dock icon. Signature verification passes and the app
relaunches with its packaged server.

## Post-beta.3 HEAD — Rebuild, smoke, and install — **PASSED 2026-08-18 (evening)**

Second rebuild of the day. The morning bundle was never installed, and eight
commits landed after it: the session-model picker fix, the model-catalog cache
fix, and the chat transcript work (tool rows, turn boundaries, reading measure,
typeface, bubble sizing).

Verified on darwin-arm64 at `14f6bd1`:

- Payload rebuilt; manifest pins `gjcSdk`/`natives` `0.14.0`.
- `env -u CI npm run tauri -- build --bundles app` produced the bundle.
- `smoke:packaged-server` reported `{"status":"ok","protocolVersion":1}`.
- Bundled client carries the day's work: `max-w-[68ch]`, `group/turn`,
  `chat.steer`, `statusTab`.
- Installed over `/Applications` after quitting the running instance, with the
  previous bundle copied to `/tmp` first. Deep signature verification passes,
  and the launched app runs its three processes with the packaged server
  answering on its loopback port.

Session data lives outside the bundle in `~/.gajae-app`, so projects, sessions
and logins survive the replacement.

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
(`security find-identity -v -p codesigning` → 0 valid identities, re-checked
2026-08-31). Ad-hoc signing is the current bar, and `spctl -a -t exec -vv`
reports `rejected` for every DMG shipped so far.

### What the packaging pipeline already does

`scripts/release/finalize-macos-app.mjs` takes its identity from
`APPLE_SIGNING_IDENTITY` (ad-hoc when unset) and, for whatever identity it is
given:

- signs every Mach-O in the bundle — found by file magic, not by a name list,
  because a vendored binary outside such a list (`@vscode/ripgrep`'s `rg`, the
  GJC natives) ships unsigned and fails notarization;
- signs with the hardened runtime and, for a real identity, a secure timestamp;
- gives `bun` the sidecar's library-validation exception, without which dyld
  refuses the GJC addon (`mapping process and mapped file have different Team
  IDs`) as soon as the runtime is hardened;
- restamps `gjc-runtime-manifest.json` inside the bundle after signing. Signing
  a native rewrites its bytes and the bundled worker refuses to start unless it
  still hashes to the pinned value (`GJC runtime manifest validation failed.`).
  The manifest is verified against the installed bytes *before* signing, so
  provenance is still checked; the restamp records what actually ships and runs
  before the outer signature seals the bundle.

`scripts/release/make-macos-dmg.mjs` signs the disk image with the same
identity, because an unsigned image cannot carry a stapled ticket.

### Remaining human gate

Provide on the Mac:

- An **Apple Developer Program** membership (99 USD/year) and a **Developer ID
  Application** certificate in the login keychain
  (Xcode → Settings → Accounts → Manage Certificates → +, or a CSR through
  developer.apple.com; keep the private key).
- Notarization credentials, stored once:

```sh
# App Store Connect API key (preferred; no password in the keychain)
xcrun notarytool store-credentials gajae-notary \
  --key ~/private_keys/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <issuer-uuid>

# or an app-specific password from appleid.apple.com
xcrun notarytool store-credentials gajae-notary \
  --apple-id you@example.com --team-id TEAMID1234 --password abcd-efgh-ijkl-mnop
```

Then cut the release with the identity exported:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"
security find-identity -v -p codesigning        # must list that identity

npm run server:payload:macos
env -u CI npm run tauri -- build --bundles app  # Tauri's own ad-hoc pass
npm run desktop:sign:macos                      # re-signs everything with the identity

# 1. notarize the app, so a copied-out .app carries its own ticket
ditto -c -k --keepParent \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Gajae Code App.app" /tmp/gajae-app.zip
xcrun notarytool submit /tmp/gajae-app.zip --keychain-profile gajae-notary --wait
xcrun stapler staple "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Gajae Code App.app"

# 2. package and notarize the image the release publishes
npm run desktop:dmg:macos
DMG="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/gajae-app-desktop-$(node -p "require('./package.json').version")-macos-arm64.dmg"
xcrun notarytool submit "$DMG" --keychain-profile gajae-notary --wait
xcrun stapler staple "$DMG"
shasum -a 256 "$DMG" > "$DMG.sha256"   # stapling changes the image
```

Acceptance (all must pass before publishing a notarized DMG):

```sh
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG"   # accepted
hdiutil attach "$DMG" -mountpoint /tmp/gajae-dmg -nobrowse
spctl -a -t exec -vv "/tmp/gajae-dmg/Gajae Code App.app"          # accepted, source=Notarized Developer ID
codesign -dv --verbose=4 "/tmp/gajae-dmg/Gajae Code App.app" 2>&1 | grep -E 'Authority|TeamIdentifier|flags'
node scripts/release/smoke-packaged-server.mjs --tauri-app "/tmp/gajae-dmg/Gajae Code App.app"
hdiutil detach /tmp/gajae-dmg
```

If `notarytool submit` fails, read the reasons — they are specific:

```sh
xcrun notarytool log <submission-id> --keychain-profile gajae-notary
```

To notarize in CI instead of locally, the macOS release job needs the
certificate `.p12` and its password, plus the notarization credentials, as
repository secrets; it imports the `.p12` into a temporary keychain, exports
`APPLE_SIGNING_IDENTITY`, and runs the same two submit/staple steps.

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
