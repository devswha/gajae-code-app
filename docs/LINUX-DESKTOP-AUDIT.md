# Linux desktop follow-up audit

The original audit followed the initial Linux build at `a456a92`, integrating
parallel fixes with `main` at `5137be4` through merge `2048955` on SDK `0.15.6`.
Those Linux package results and checksums remain historical evidence. The
current source retains app version `2.0.0-beta.8` and desktop version `0.2.2`,
but now pins SDK `0.16.4`.

## Combined-tree qualification (2026-09-06 KST)

Merge `de994ed` includes `main` at `6d98bee` (PR #35 provider catalog/selection
fixes); merge `10c8ebc` includes SDK qualification commit `8d62924`. Both
review fixes remain in the combined tree: `5f4c948` permanently revokes replaced
terminal sockets after PTY exit, and `b97d90f` makes the packaging/smoke entry
points execute through symlinked checkout paths and fixes macOS fixture path
comparisons. The SDK upgrade's deterministic `contract-profile` test is retained
instead of relying on a changing built-in model profile.

| Check | Combined-tree result |
| --- | --- |
| Local `npm ci` and SDK pin | Passed; installed SDK `0.16.4` with Node `22.23.1` and Bun `1.4.0` |
| Local `npm run verify` | Passed: audit, licenses, notices, typecheck, Rust formatting/Clippy, 61 Rust core tests, 709 Node server tests (2 skipped), 97 server Bun tests (1 live smoke skipped), 469 Node client tests, 196 client Bun tests, 97 script tests (10 Linux-only skips), lint, identity and all build stages |
| Local Tauri formatting and tests | Passed on macOS arm64: 27 tests; bundle inputs disabled for tests because no packaged payload is built here |
| New Linux package build and Ubuntu 22.04/24.04 package/GUI checks | Pending fresh Linux CI artifacts after this combined tree is pushed |

The local Rust toolchain is `1.85.1`. Tauri ran with
`TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo test --locked --manifest-path src-tauri/Cargo.toml`
after the formatting check. These tests exercise the shared/macOS shell code;
Linux-only instance tests and real Linux packaging still require Linux CI.
The full gate used `GJC_CONTRACT_LIVE=0`; no live model call or standalone
GJC E2E run was added to this integration check. The generated manifests,
command catalog and notices remained unchanged after the successful build.

The SDK qualification recorded at `8d62924` independently passed its full source
gate, eight GJC E2Es and an isolated `openai-codex/gpt-6-astra` / `xhigh` live
response/abort smoke before integration. Those results are not a claim that
the live smoke or Linux package checks have been rerun on this combined tree.

## Findings and fixes

| Finding | Result |
| --- | --- |
| Closing an old terminal socket detached its replacement; old PTY callbacks could affect a newer session | Ownership checks, stable session/child references and guarded expiry preserve the current connection. Both terminal regression suites pass. |
| A replaced terminal socket could reclaim ownership after PTY exit removed the session entry | Permanent socket revocation survives PTY exit and force-restart; both failing-before regressions pass with `5f4c948`. |
| Symlinked packaging/smoke CLI paths could exit successfully without running any checks | Entry-point comparisons canonicalize both paths; build/restore guards and real staging fixture checks cover the corrected behavior in `b97d90f`. |
| Workspace Browser was disabled by the macOS-only desktop gate | Linux x64 browser support is enabled; native computer/CUA support remains separately gated. |
| Browser's external-open button used `window.open`, which does not reach the system browser from the desktop webview | HTTP/HTTPS preview pages use an authenticated sidecar opener. OAuth/document links retain the existing HTTPS-only policy. |
| AppRun's Python and GTK search paths broke system Python and Ubuntu 24.04 `gio` | Server bootstrap removes image-owned tool paths while preserving host paths and credentials. The Rust UI keeps its bundle environment. Real AppRun terminal tests prove the fix. |
| Managed Chromium could fail the Linux sandbox policy even though installed Chrome worked | Only managed Linux sandbox failures retry known installed stable Chrome with the same private app profile. Explicit overrides, non-sandbox failures and sandbox flags are preserved. `libnss3` supplies the missing NSS/NSPR dependency. |
| Second launches dropped activation, and failed startup/Retry had gaps | Per-user IPC forwards activation and links; close fences late spawns; failed children are bounded and reaped; Retry restores the local IPC-capable recovery page. Health reads have size/time limits. |
| An unstarted automation service could unlink another socket; idle clients could stall shutdown | Binding refuses occupied paths; shutdown closes owned connections and clears only its own bridge environment. |
| Package metadata omitted the libc floor and URI arguments | Debian declares libc/NSS/desktop-file-utils requirements. The desktop template passes `%U`; actual installation and MIME registration are checked. |
| Alternate Cargo targets and stale/shared output could select or delete the wrong artifacts | Cleanup/staging follow Cargo metadata and refuse foreign bundle contents before mutation. AppImage restoration validates source inputs and preserves the original image on recompression failure. |
| Screenshot-only checks could pass a blank window and missed descendants | GUI checks require all three rendered phrases for two consecutive frames, track descendants/reparented children, verify closed ports and retain failure evidence. Contrast OCR handles Tesseract 4 and 5 without weakening the phrase requirements. |
| Clean dependency installation hit GitHub ripgrep API limits | Both CI build paths seed the existing checksum-verified ripgrep cache before `npm ci`. |

The shared macOS payload builder retains its platform checks, signing and native
closure verification. The concurrent main-branch fixes and tests were preserved,
including stable QA storage, browser session/frame isolation and terminal URL state.

## Historical Linux verification (SDK 0.15.6)

The following table records the original Linux audit, before the combined-tree
merges above. It must not be used as package acceptance for SDK `0.16.4`.

| Check | Result |
| --- | --- |
| `npm run verify` on the integrated tree | Passed: 61 Rust core, 708 Node server, 469 Node client and 134 script tests, plus 6 server and 33 client Bun test files |
| Tauri formatting and tests | Passed, 37 Rust tests |
| GJC wire/driver e2e | 8 passed |
| Chromium source e2e | 3 passed on the host with isolated profiles |
| Managed/private Chrome fallback | Reproduced the sandbox failure, then passed using installed stable Chrome and the same private profile; no sandbox-disabling flags |
| Ubuntu 22.04/glibc 2.35 native package build | Both `.deb` and AppImage passed |
| Final packages on Ubuntu 22.04 and Ubuntu 24.04 | Both formats passed native hashes, auth/bootstrap replay, HTTP/WebSocket isolation, terminal reconnect, jobs migration and data survival |
| Final AppRun environment on both systems | System Python and `gio` commands passed through the server terminal |
| GUI on both systems | Both formats passed two launches, persistent OCR, close/reap and closed-port checks |
| Installed Ubuntu 22.04 `.deb` | Installation, desktop entry/URI registration and two GUI launches passed |
| Additional X11/Openbox lifecycle drill | 11 checks passed on the audited debug shell with a disposable earlier payload, including activation/focus, startup links, Retry and startup close |
| Native Wayland | A single earlier-package startup/render probe passed under Weston 9 headless pixman, without Xwayland; screenshot and full OCR phrases matched |

Ubuntu 22.04 was tested in a container on the host kernel; Ubuntu 24.04 was the
host. Native Wayland cleanup used signals and is not a final-package interactive
GNOME/KDE close/relaunch acceptance. The container's default namespace restrictions
blocked a separate Chromium sandbox launch; the application does not disable the
sandbox to work around that restriction. Browser runtime and fallback checks ran
successfully on the host.

The GUI, protocol and AppRun tests use disposable homes/profiles and no real
provider credentials. Real account login/consent, physical desktop combinations,
and native Linux CUA control are not claimed by this audit.

## Artifacts and evidence

The original audit staged Linux binaries and checksums in `release/desktop/`;
their historical hashes and installation instructions are in
[DESKTOP-LINUX.md](DESKTOP-LINUX.md). Earlier local binaries were retained under
`.desktop-build/releases-a456a92/`. No new Linux package checksums are claimed
for the combined SDK `0.16.4` source tree.

The original audit retained generated evidence under `.desktop-build/linux-audit-evidence/`
and `.desktop-build/linux-audit-final-artifacts/`, including the full gate,
container build/test logs, package protocol checks, and OCR GUI reports/images.
Additional lifecycle evidence is in `.desktop-build/lifecycle-gui/reports/`.
These files are local build/test artifacts and are excluded from commits.

The Linux workflow now applies the server, AppRun, installed-package and OCR GUI
checks to Ubuntu 22.04 and 24.04 and uploads GUI evidence even after failure.
GitHub Actions execution is distinct from the completed local/container checks.

## SDK qualification boundary

SDK `0.16.4`, its lockfile, both supported native platform manifests, command
catalog and notices are now integrated from `8d62924`. The original explicit
provider-ID regression and the separate logical-session / async-endpoint
accessor checks are included. The app's redundant-ID mitigation remains.
The SDK's child permission-bypass regression still reproduces at this version;
identity qualification does not qualify unrestricted delegation. Fresh Linux
CI packages and their package/GUI checks remain the next packaging gate.
