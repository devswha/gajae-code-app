# Linux desktop (x86_64)

Gajae Code App has a native Tauri 2 Linux desktop build path producing `.deb`
and `.AppImage` packages. Each package carries the web client, server, Rust
core, native dependencies, **Node.js 22.22.2**, and **Bun 1.4.0**. An installed
package uses its bundled runtimes; building from source requires Node and Rust.

Linux desktop is available as a source/local build. No published Linux desktop
download is claimed here. The Linux desktop workflow uploads build artifacts
for validation and does not publish a GitHub Release or send announcements.

## Compatibility and validation status

| Item | Build/check target |
| --- | --- |
| Architecture | Linux x86_64, Rust target `x86_64-unknown-linux-gnu` |
| CI build host | Ubuntu 22.04, glibc 2.35; configured, not yet run |
| CI package checks | Both formats on Ubuntu 22.04 and Ubuntu 24.04; configured, not yet run |
| Local Ubuntu 24.04 build | glibc 2.39; both formats verified under X11/Xvfb |
| Bundled runtimes | Node 22.22.2 and Bun 1.4.0 |
| Other targets | Linux arm64, musl/Alpine, and cross-compilation are not covered |

The glibc floor depends on where the binaries are built. Building successfully
on Ubuntu 24.04 does not prove that those binaries run on Ubuntu 22.04. Use
the Ubuntu 22.04 CI build for the intended glibc 2.35 baseline, and require
both package smoke jobs to pass before claiming compatibility. AppImage does
not remove the need for a compatible Linux system and desktop libraries.

Verified on **2026-09-05** with **2.0.0-beta.8**, Ubuntu 24.04.4 x86_64,
glibc 2.39, and X11 through Xvfb:

- Both extracted formats passed runtime/native hash checks, SQLite, PTY, Gajae
  native/Bun loading, authentication, jobs migration, and `--data-survival`
  (job/event resume and idempotent schemas).
- Both rendered the UI in a clean environment outside the checkout, including
  the AppImage's `AppRun`. Each passed two healthy launches using the same
  isolated state; `WM_DELETE_WINDOW` returned exit code `0` and all tracked
  child processes exited. The first-launch screenshots have identical SHA-256.
- Final `npm run verify` passed with exit code `0`, including the runtime
  restoration files and all **73 script tests**. All **19 Tauri Cargo tests**
  passed. The final `--locked` build-argument change separately passed three
  focused tests.

Linux CI is **not run**. Real Wayland, package installation/desktop-menu
integration, provider browser handoff, and real provider calls are **not
tested**. Deep-link relay to an already running instance is **pending**.
The final `npm run desktop:build:linux` completed successfully, including
runtime restoration and checksum staging. Local Ubuntu 24.04 results do not
establish the Ubuntu 22.04 compatibility floor.

Local evidence (generated files, not published assets):

| Check | Evidence |
| --- | --- |
| Full verification | `/tmp/gajae-linux-final-gate.log` |
| Single-command build | `/tmp/gajae-linux-acceptance-build.log` |
| Final artifact acceptance | `.desktop-build/linux-release-acceptance.json` |
| `.deb` package smoke | `/tmp/gajae-accepted-deb-native.log` and `/tmp/gajae-accepted-deb-data-survival.log` |
| AppImage package smoke | `/tmp/gajae-accepted-appimage-native.log` and `/tmp/gajae-accepted-appimage-data-survival.log` |
| `.deb` GUI | `.desktop-build/linux-deb-gui-report.json` and its referenced screenshots |
| AppImage GUI | `.desktop-build/linux-appimage-gui-report.json` and its referenced screenshots |

## Build prerequisites

Use an x86_64 Ubuntu 22.04 or 24.04 host. Install the Tauri 2 system libraries
and build tools before `npm ci`:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y \
  build-essential pkg-config curl wget file unzip git ca-certificates \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  libxdo-dev libssl-dev librsvg2-dev patchelf xdg-utils
```

Install Node.js **22.22.2** for parity with desktop CI, plus Rust through
rustup. General source development also accepts the Node ranges in
`package.json.engines`; the desktop payload always pins its own Node runtime.
The workflow uses Rust 1.85.1 with rustfmt:

```bash
rustup toolchain install 1.85.1 --profile minimal --component rustfmt
rustup override set 1.85.1
rustup target add x86_64-unknown-linux-gnu
node --version                       # v22.22.2 in desktop CI
rustc --version
getconf GNU_LIBC_VERSION             # record this with the build result
```

Run these commands from the repository root. Fetch Bun through the repository
script so its pinned download and checksum checks apply:

```bash
node scripts/release/prime-ripgrep-cache.mjs
npm ci
node scripts/fetch-bun.mjs
dist-native/bun --version            # 1.4.0
```

The ripgrep cache helper verifies the pinned binary before installation and
avoids depending on an authenticated GitHub API request during postinstall.

## Build the packages

```bash
npm run desktop:build:linux
```

This command uses `scripts/release/build-linux-desktop.mjs` to build the payload,
clear stale Tauri staging directories, run Tauri with
`--bundles deb,appimage --target x86_64-unknown-linux-gnu -- --locked`, restore
the AppImage runtime, and stage both packages with
`scripts/release/stage-linux-desktop.mjs`.
To build just the embedded payload, use `npm run server:payload:linux`.

`linuxdeploy` can modify ELF RPATHs in Bun and Gajae native bindings.
`scripts/release/restore-linux-appimage.mjs` restores the verified runtime to
the assembled AppDir, checks native hashes against the runtime manifest, and
recompresses it using Tauri's AppImage output plugin. This preserves manifest
integrity after `linuxdeploy` modifications. Staging and final checksums run
after restoration.

The wrapper unsets `CI` to avoid Tauri's rejection of `CI=1` and defaults
`APPIMAGE_EXTRACT_AND_RUN=1` so AppImage build tools can run without a FUSE
mount. The npm command and canonical output names remain the same.

The canonical staged output uses **`package.json.version`**, rather than
the shell's separate `desktopVersion`:

```text
release/desktop/gajae-app-desktop-<version>-linux-x64.deb
release/desktop/gajae-app-desktop-<version>-linux-x64.deb.sha256
release/desktop/gajae-app-desktop-<version>-linux-x64.AppImage
release/desktop/gajae-app-desktop-<version>-linux-x64.AppImage.sha256
```

Final local build artifacts (2026-09-05, Ubuntu 24.04 x86_64):

| Format | Size | SHA-256 |
| --- | --- | --- |
| `.deb` | 165.4 MiB | `d44bbd50df4eb87777bfc1c3400bd429506a2fbfcb119aa43e7148026dddd094` |
| `.AppImage` | 211.4 MiB | `f46cb76f3ebf2c427ce8adaf9a59e1b31870b3497f7a5067997ed5f18315c371` |

Tauri's intermediate packages live under
`src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/`. Keep generated
payloads, runtimes, Cargo targets and `release/` artifacts out of commits.

From the repository root, check both staged packages:

```bash
LINUX_VERSION="$(node -p "require('./package.json').version")"
LINUX_ASSET="gajae-app-desktop-${LINUX_VERSION}-linux-x64"
(
  cd release/desktop
  sha256sum --check "$LINUX_ASSET.deb.sha256"
  sha256sum --check "$LINUX_ASSET.AppImage.sha256"
)
dpkg-deb --info "release/desktop/$LINUX_ASSET.deb"
```

## Install or launch a local build

Run these after the build and checksum commands above, in the same shell.
On a graphical Ubuntu desktop, install the Debian package with apt so its
declared system dependencies are resolved:

```bash
sudo apt install "./release/desktop/$LINUX_ASSET.deb"
gajae-app-desktop
```

You can also launch **Gajae Code App** from the applications menu. Rebuilding
the same desktop version and installing the local `.deb` again may require
`sudo apt install --reinstall "./release/desktop/$LINUX_ASSET.deb"`.

For the AppImage:

```bash
chmod +x "release/desktop/$LINUX_ASSET.AppImage"
"./release/desktop/$LINUX_ASSET.AppImage"
```

If the system cannot mount AppImages through FUSE, use extraction at launch:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 "./release/desktop/$LINUX_ASSET.AppImage"
```

The desktop shell needs a graphical session with GTK/WebKitGTK available.
It starts its bundled server on loopback; no separate Node/Bun installation
or manually started server is needed. Keep Git and CA certificates installed
on the host; the `.deb` declares `git` and `ca-certificates` as dependencies,
and AppImage users must provide them too. App data lives outside the package in
`~/.gajae-app`, and GJC configuration and credentials live in `~/.gjc`.
Keep these directories when replacing a package or AppImage.

## Verify the extracted packages

Run the packaged-server harness from this checkout, pointing it at an
extraction **outside the checkout**. This prevents Node or Bun from resolving
a dependency accidentally omitted from the package through the repository's
`node_modules`. Extraction does not require installing the `.deb` or mounting
the AppImage with FUSE.

With `LINUX_ASSET` set as above, check the `.deb`:

```bash
(
  set -euo pipefail
  LINUX_ROOT="$(mktemp -d /tmp/gajae-deb-smoke.XXXXXX)"
  trap 'rm -rf "$LINUX_ROOT"' EXIT
  dpkg-deb -x "release/desktop/$LINUX_ASSET.deb" "$LINUX_ROOT"
  npm run smoke:packaged-server -- --linux-root "$LINUX_ROOT"
  npm run smoke:packaged-server -- --linux-root "$LINUX_ROOT" --data-survival
)
```

Then check the AppImage's `squashfs-root`:

```bash
(
  set -euo pipefail
  APPIMAGE="$(pwd)/release/desktop/$LINUX_ASSET.AppImage"
  EXTRACT_DIR="$(mktemp -d /tmp/gajae-appimage-smoke.XXXXXX)"
  trap 'rm -rf "$EXTRACT_DIR"' EXIT
  chmod +x "$APPIMAGE"
  (cd "$EXTRACT_DIR" && "$APPIMAGE" --appimage-extract >/dev/null)
  npm run smoke:packaged-server -- --linux-root "$EXTRACT_DIR/squashfs-root"
  npm run smoke:packaged-server -- --linux-root "$EXTRACT_DIR/squashfs-root" --data-survival
)
```

Pass the extracted root to `--linux-root`, not its `usr/bin` directory or the
payload directory. The standard smoke checks bundled runtime/native loading,
health identity, bootstrap authentication, API access and a job round trip.
The separate `--data-survival` invocation checks state through shutdown and
restart. These use temporary app data; neither invocation is GUI acceptance.

## CI and acceptance evidence

`.github/workflows/desktop-linux.yml` runs on pull requests, pushes to `main`,
and manual dispatch. The workflow:

1. Requires an x86_64 Ubuntu 22.04 build host with glibc 2.35 and Node 22.22.2.
2. Installs the system prerequisites and pinned Bun, then builds both packages.
3. Checks Tauri Rust formatting and runs the shell's locked Cargo tests after
   the build, when the required payload sidecar exists.
4. Requires exactly the two canonical packages and their valid SHA-256 files.
5. Uploads `gajae-app-desktop-linux-x64` as a workflow artifact, retained for
   14 days.
6. Downloads those same bytes on Ubuntu 22.04 and 24.04 and checks both extracted
   formats with the standard and data-survival smoke invocations.

The desktop shell checks can also be run locally after building the packages:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && \
  cargo test --locked --manifest-path src-tauri/Cargo.toml
```

The upload happens before the downstream smoke jobs; an artifact's existence
alone is not a passing result. Check the whole workflow. The existing source
CI still runs `npm run verify`, which checks the Rust core but does not run
the Tauri shell's Cargo tests. The test scanner includes
`scripts/release/*.test.mjs` in that existing gate; no separate CI JavaScript
test step is needed. The protected release workflow is unchanged and does not
attach these Linux desktop packages to a release.

For acceptance, record the commit SHA, host/architecture, glibc version,
package filenames and checksums, build result, each smoke result, and whether
the package was built locally or downloaded from CI. Preserve the distinction
between an Ubuntu 24.04 local build and the Ubuntu 22.04 CI baseline.

On an actual Linux desktop, separately exercise package install/launch,
the rendered window, provider sign-in links opening the browser, a session
create/abort/resume cycle, quit/relaunch persistence, and sidecar cleanup.
Record the desktop environment and whether the session uses X11 or Wayland.
Leave any unrun step marked **not run**. Do not infer Linux GUI success from
the [macOS verification record](DESKTOP-TAURI-VERIFICATION.md).
