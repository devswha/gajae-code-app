# Windows desktop preview

The Windows port builds an x64 NSIS installer from this branch. It includes
Node 22.22.2, Bun 1.4.0, GJC SDK 0.16.4, the Rust core, the server, and the
web UI. Windows ARM64 and 32-bit builds are not supported by this payload.

This is a preview build path. It is not part of the signed macOS release lane.
The Windows workflow uploads an unsigned installer and SHA-256 file as Actions
artifacts; it does not create a GitHub Release. Windows may show an unknown
publisher warning until a Windows signing certificate is configured.

The merged source targets package `2.0.0-beta.9` and desktop version `0.2.3`.
No Windows build, CI result, or interactive acceptance result for this merged
source is claimed below; the verification record is explicitly historical.

## Build on Windows

Use Windows 10 version 1809 or later (Bun's minimum), or Windows 11, on x64.
Install these development prerequisites:

- Node.js 22.22.2+ (22.x) or 24.15.0+ (24.x), with npm.
- Git for Windows, available on PATH; the agent's shell tools also need its Bash.
- Visual Studio 2022 Build Tools, including Desktop development with C++, an
  MSVC x64 toolchain and a Windows SDK. Python 3 is needed if a native npm module
  must build from source.
- Rust through rustup. `rust-toolchain.toml` selects the project's Rust version.
- Microsoft Edge WebView2 Runtime for the desktop window.

Follow the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for the C++ toolchain and WebView2. The
[Bun installation requirements](https://bun.com/docs/installation) define the
runtime's Windows minimum. The application's interactive acceptance checks
below must still be run on the intended Windows version.

Windows PowerShell 5.1's legacy compiler needs ASCII temporary filenames. When
the temporary directory contains Unicode, the worker uses a verified Windows
8.3 alias of the same protected directory and restores its environment after
compilation. If that volume has no usable short names, the app reports an error;
use an ASCII, writable `TEMP` and `TMP` for the launch/build session. Profiles,
project paths and installed app paths can still contain Unicode.

In PowerShell, from the repository root:

```powershell
npm ci
npm run desktop:build:windows
```

The build fetches checksum-pinned Windows runtimes, compiles the application,
installs production dependencies into the payload, verifies native modules and
worker initialization from a copy outside the checkout, then creates an NSIS
installer. The build must run natively on Windows x64: Linux/macOS dependency
installations cannot supply the Windows native modules.

Installer output:

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe
```

For the development shell, stage the payload first:

```powershell
npm run server:payload:windows
npm run desktop:dev
```

Rebuild the payload after changing the server or frontend: the desktop shell
loads the staged production payload. To develop with Vite's hot reload instead,
run `node scripts/fetch-bun.mjs`, then `npm run dev`, and open the client in a
browser.

## Automated checks

The `Windows desktop` workflow in `.github/workflows/windows.yml` runs on
`windows-2022` for this branch, main and pull requests to main. It checks source,
Rust core tests, a Windows runtime regression suite, and desktop lifecycle tests.
An initial compiler job probes both ordinary and isolated Unicode temporary
paths before the build job installs npm dependencies.
It builds the NSIS installer, installs it into a temporary directory containing
spaces and Korean text, then verifies the installed server payload before
uploading the installer and checksum.

The focused Windows regression suite can also run locally after building:

```powershell
npm run test:windows
```

The existing complete `npm run verify` suite remains the Linux regression gate.
A successful focused Windows check does not imply every legacy test fixture is
portable to Windows.

To compare a downloaded beta.9 installer against its companion checksum:

```powershell
Get-FileHash .\gajae-app-desktop-2.0.0-beta.9-windows-x64-setup.exe -Algorithm SHA256
Get-Content .\gajae-app-desktop-2.0.0-beta.9-windows-x64-setup.exe.sha256
```

## Interactive acceptance before release

A native runner can verify compilation and installed backend behavior. Record
these additional checks on a Windows desktop before calling the preview a
validated public release:

1. Install as a regular user and open the app through the Start menu. Confirm
   that the window renders and reaches the supervised loopback server.
2. Create a project under a path containing spaces and Korean text; authenticate
   a provider and run a real agent turn that edits and reads a file.
3. Exercise the terminal, open a file in an editor, and check approval prompts.
4. Stop an active turn; close the app and confirm its server/worker/terminal
   descendants exit. Relaunch and check that sessions and settings survive.
5. Open a `gajae-app://` link with the app closed and with it already running.
6. Reinstall and uninstall, checking user-data preservation and removal of app
   shortcuts and protocol registration.

Native macOS computer-control integration is separate from the browser and
terminal tools; this port does not add a Windows native computer-control driver.

## HISTORICAL verification record — beta.8 / commit `2889326` — September 5, 2026

> **Historical evidence only.** The record below applies to package
> `2.0.0-beta.8`, desktop version `0.2.2`, and the Windows source at commit
> `2889326`. It does not verify the merged package `2.0.0-beta.9`, desktop
> version `0.2.3`, or GJC SDK `0.16.4`; no current Windows CI or interactive
> acceptance result is claimed here.

- Linux x64, Node 24.18.0, code commit `21ac3b6`: `npm run verify` passed,
  including 1,440 JavaScript and Bun tests and 59 Rust unit tests plus four
  Rust process tests.
- Native Windows CI run `33958813323`, code commit `2889326`, passed on
  `windows-2022`: 49 build-tool tests, 108 runtime tests, 60 Rust core unit tests,
  four Rust process tests, and 19 Tauri desktop tests. One Rust fixture is
  intentionally excluded from direct execution and is launched by its owning
  process-tree test.
- The NSIS installer was built, installed under a path containing spaces and
  Korean text, and the installed payload passed SQLite, ConPTY, native core,
  ripgrep, Bun worker, supervised model catalog/Job ownership, desktop
  authentication, frontend delivery and graceful shutdown checks.
- The installer remains unsigned. Interactive GUI, provider sign-in, a real
  agent turn, and reinstall/uninstall acceptance remain in the checklist above.

Verified preview artifact from that run:

```text
gajae-app-desktop-2.0.0-beta.8-windows-x64-setup.exe
SHA-256: 3e5431de5c9a372f971a5643e9cda3a3352fb52e2efb75d2949906eac5b74eef
```

The downloaded installer matches the companion checksum. The CI artifact is
named `gajae-app-desktop-windows-x64` and is retained for 14 days; source builds
remain available after it expires.
