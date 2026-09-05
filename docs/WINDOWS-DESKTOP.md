# Windows desktop preview

The Windows port builds an x64 NSIS installer from this branch. It includes
Node, Bun 1.4.0, the Rust core, the server, and the web UI. Windows ARM64 and
32-bit builds are not supported by this payload.

This is a preview build path. It is not part of the signed macOS release lane.
The Windows workflow uploads an unsigned installer and SHA-256 file as Actions
artifacts; it does not create a GitHub Release. Windows may show an unknown
publisher warning until a Windows signing certificate is configured.

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

To compare the downloaded installer against the companion checksum:

```powershell
Get-FileHash .\gajae-app-desktop-2.0.0-beta.8-windows-x64-setup.exe -Algorithm SHA256
Get-Content .\gajae-app-desktop-2.0.0-beta.8-windows-x64-setup.exe.sha256
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

## Verification record — September 5, 2026

- Linux x64, Node 24.18.0: `npm run verify` passed, including 1,428 JavaScript
  and Bun tests and 58 Rust unit tests plus three Rust process tests.
- The focused Windows contracts also pass on Linux; tests requiring actual
  Windows APIs remain gated to the Windows runner.
- Tauri wrapper/bootstrap/icon tests and Rust formatting passed. The Windows
  shell sources passed a cross-target compile/Clippy check in an isolated
  harness; this did not build or run the installer.
- Native Windows CI and interactive acceptance are separate evidence. The
  checklist above records what must still be verified before public release.
