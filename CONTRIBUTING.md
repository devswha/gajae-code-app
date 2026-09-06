# Contributing to Gajae Code App

Gajae Code App is a self-hosted web and desktop interface for GJC. Small,
well-explained changes are easier to review and safer to release.

## Start with the existing work

- Search [issues](https://github.com/devswha/gajae-code-app/issues) and [pull requests](https://github.com/devswha/gajae-code-app/pulls) before opening a duplicate.
- Open an issue first when a change affects product behavior, APIs, or architecture.
- A focused bug fix may be submitted directly when its cause and scope are clear.

## Local setup

Install Git, a supported Node.js release (`>=22.22.2 <23` or `>=24.15.0 <25`),
and the GJC tooling needed for the area you are changing. Then create a branch
from your fork and install dependencies:

```bash
git clone https://github.com/<your-account>/gajae-code-app.git
cd gajae-code-app
npm install
git switch -c fix/short-description
```

Run the development servers with:

```bash
npm run dev
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run server:dev` | Run the backend through `tsx`. |
| `npm run client` | Start the Vite development server. |
| `npm run build` | Build the client, server, and native core. |
| `npm run typecheck` | Check the TypeScript projects. |
| `npm test` | Run the repository test suite. |
| `npm run lint` | Check JavaScript and TypeScript style. |
| `npm run check:identity` | Validate the product and release identity. |
| `npm run server:payload:linux` | Build the Linux x64 server payload with pinned Node 22.22.2 and Bun 1.4.0. |
| `env -u CI npm run desktop:build:linux` | Build and stage Linux x64 `.deb` and `.AppImage` packages with checksums. |

### Linux desktop development

Use native x86_64 Linux with Rust and the GTK 3/WebKitGTK 4.1 development
libraries listed in [docs/DESKTOP-LINUX.md](docs/DESKTOP-LINUX.md). Use Node
**22.22.2** to match desktop CI; the packaged app includes its own Node and Bun.
`npm run desktop:build:linux` builds the payload, runs Tauri for
`x86_64-unknown-linux-gnu`, and stages packages in `release/desktop/` using
`package.json.version` in the filenames.

The separate `.github/workflows/desktop-linux.yml` workflow runs on pull
requests, pushes to `main`, and manual dispatch. It builds on Ubuntu 22.04
(glibc 2.35), then extracts and smokes both package formats on Ubuntu 22.04
and 24.04. It uploads build artifacts without publishing a release or sending
announcements. It also checks Tauri Rust formatting and runs the shell's locked
Cargo tests after the bundle build. Ordinary source verification remains in
the existing CI workflow; `npm run verify` covers the Rust core, not the Tauri
shell tests.

For desktop changes, follow the Linux guide's out-of-checkout package smoke
and `--data-survival` commands, then record the host, commit, package hashes,
and results. An Ubuntu 24.04 local build uses glibc 2.39; only a successful
Ubuntu 22.04 build and smoke provide evidence for the glibc 2.35 floor.
Headless server checks do not verify the desktop window: report interactive
GUI checks separately, and do not describe unrun checks as passed.

## Repository map

- `src/` contains the React client, UI components, translations, and browser utilities.
- `server/` contains the HTTP server, runtime integration, routes, and backend services.
- `shared/` holds code shared between browser-facing and server code.
- `native/gajae-core/` contains the Rust native core.
- `public/` provides static browser assets.
- `docs/` contains installation and operational guidance.

## Change expectations

Keep one concern in each pull request. Describe the problem, the resulting
behavior, and how you checked it. Include reproduction steps for a defect;
include before-and-after images or recordings when a UI change needs them.
Update tests and documentation when a behavior or operator workflow changes.

Use an imperative commit subject with a conventional type where it helps readers
scan the history, for example `fix: prevent duplicate session creation` or
`docs: clarify the rollback procedure`. Do not combine unrelated cleanup with a
behavioral change.

Before requesting review, run the focused checks for the affected code and any
required project checks. A typical full local gate is:

```bash
npm run verify
```

## Pull request review

A pull request should state its intent, link the relevant issue when one exists,
and call out compatibility, security, operational, or migration consequences.
Reviewers may request a smaller scope, tests, or documentation before merging.

## Releases and operations

Release installation, update, rollback, and service procedures live in
[docs/SELF-HOST.md](docs/SELF-HOST.md). Use an approved immutable commit SHA for
source-checkout updates rather than a moving branch:

```bash
./scripts/gajae-app.sh status
./scripts/gajae-app.sh update --ref <approved-full-commit-sha>
```

## Contribution terms

By submitting a contribution, you agree to the terms in [LICENSE](LICENSE) and,
for a first contribution, the [Contributor License Agreement](CLA.md). Read both
before opening a pull request.
