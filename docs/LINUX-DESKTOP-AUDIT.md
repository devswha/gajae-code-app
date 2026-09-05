# Linux desktop follow-up audit

This audit follows the initial Linux build at `a456a92`. It integrates the
parallel fixes with `main` at `5137be4` through merge `2048955`. The app remains
`2.0.0-beta.8`, with desktop version `0.2.2` and SDK `0.15.6`.

## Findings and fixes

| Finding | Result |
| --- | --- |
| Closing an old terminal socket detached its replacement; old PTY callbacks could affect a newer session | Ownership checks, stable session/child references and guarded expiry preserve the current connection. Both terminal regression suites pass. |
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

## Verification

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

The final Linux binaries and checksums are in `release/desktop/`; their hashes
and installation instructions are in [DESKTOP-LINUX.md](DESKTOP-LINUX.md).
Previous local binaries are retained under `.desktop-build/releases-a456a92/`.

Generated evidence is retained under `.desktop-build/linux-audit-evidence/`
and `.desktop-build/linux-audit-final-artifacts/`, including the full gate,
container build/test logs, package protocol checks, and OCR GUI reports/images.
Additional lifecycle evidence is in `.desktop-build/lifecycle-gui/reports/`.
These files are local build/test artifacts and are excluded from commits.

The Linux workflow now applies the server, AppRun, installed-package and OCR GUI
checks to Ubuntu 22.04 and 24.04 and uploads GUI evidence even after failure.
GitHub Actions execution is distinct from the completed local/container checks.

## Separate follow-up

PR #30 / issue #18 remain open. The registry now publishes SDK `0.16.4`; its
published source/changelog contains the logical-session/async-identity fix that
the PR was waiting for. The next action is to qualify that version with the
prepared app-shaped regression and skill matrix, then update the pin/manifest
through the existing PR. This audit does not silently change the SDK version.
