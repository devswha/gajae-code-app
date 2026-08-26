# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

Gajae Code App (`gajae-app`, v2.0.0-beta.x) — a self-hosted web + desktop UI for the GJC
coding agent. AGPL-3.0-or-later. Four runtime layers:

- `src/` — React 18 SPA (Vite 7, Tailwind 3, react-router, i18next, CodeMirror).
- `server/` — Express backend (`server/index.js` entry), SQLite via better-sqlite3,
  WebSocket, node-pty terminals. TypeScript + JS mixed, run through `tsx`.
- `native/gajae-core/` — Rust core, built to `dist-native/` by `scripts/build-rust-core.mjs`.
- `src-tauri/` — Tauri 2 desktop shell (Rust: `supervisor.rs`, `lifecycle.rs`,
  `navigation.rs`); packages the server as a payload and supervises it.

`shared/` is code shared between client and server (product identity, network hosts,
job projection protocol). `scripts/` holds build/release/verify tooling.

## Environment

- Node 22.22.2+ (22.x) or 24.15.0+ (24.x) — the test runner refuses other majors.
  On the primary Mac: `. "$HOME/.nvm/nvm.sh" && nvm use 22`.
- Rust/cargo required for `check:core`, `build:core*`, and the Tauri shell
  (`. "$HOME/.cargo/env"`).
- Bun **exactly 1.4.0** for `*.bun.test.ts` files (pinned in `scripts/fetch-bun.mjs`):
  `dist-native/bun` or PATH; fetch with `node scripts/fetch-bun.mjs`.
- Server binds loopback by default (fail-closed; it can run shell commands).
  `SERVER_PORT` defaults to 3001, Vite dev on 5173. Do not export `SERVER_PORT=0`.
- Tauri builds choke on `CI=1`: use `env -u CI npm run tauri -- build`.

## Commands

```bash
npm run dev              # server (tsx, :3001) + vite client (:5173); prebuilds rust core
npm test                 # all tests via scripts/run-tests.mjs (node:test + bun test)
npm run typecheck        # tsc on both tsconfig.json and server/tsconfig.json
npm run lint             # eslint src/ server/ shared/ scripts/ + configs
npm run check:core       # cargo fmt --check + clippy -D warnings + cargo test
npm run verify           # FULL GATE: audit + typecheck + check:core + test + lint + check:identity + build
npm run test:e2e:gjc     # 7 GJC wire/browser e2e tests (separate from npm test)
npm run desktop:dev      # Tauri dev shell
```

Run a single test file (match the runner's env):

```bash
# server test (node:test via tsx)
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/gjc-worker.test.ts
# client test
TSX_TSCONFIG_PATH=tsconfig.json node --import tsx --test src/stores/useSessionStore.test.ts
# bun-runtime test (files named *.bun.test.ts)
dist-native/bun test server/gjc-sdk-contract.bun.test.ts
```

`npm test` has a `pretest` that builds the Rust core (debug); tests fail without it.

## Architecture notes

- **GJC provider isolation**: GJC is the *only* provider routed through an isolated
  worker (`server/gjc-worker.ts` + `gjc-worker-client.ts`, protocol in
  `gjc-worker-protocol.ts`, Bun SDK adapter in `gjc-bun-sdk-adapter.ts` /
  `gjc-bun-sdk-events.ts`). Claude/Codex/Cursor/OpenCode keep their own paths.
  Contract: `server/GJC-LIVE-SPEC.md`. Prompts are passed via owner-readable temp
  file (`@file`), never on the process argv.
- **Backend module boundaries are lint-enforced**: `eslint-plugin-boundaries` rules in
  `eslint.config.js` govern imports between `server/modules/*`
  (assets/automation/database/notifications/projects/providers/websocket) and fail on
  unknown dependencies. Do not add cross-module imports that violate them.
- **Product identity is checked**: `npm run check:identity` verifies names/URLs/scheme
  against `shared/productIdentity.js`. Change identity constants there, nowhere else.
- **Design system**: all product colors route through semantic CSS variables in
  `src/index.css` + Tailwind aliases in `tailwind.config.js`. See `DESIGN.md` before
  touching UI styling; do not hardcode palette values.
- **Bundled runtime manifest**: `server/gjc-runtime-manifest.json` is filled by
  `npm run fill:runtime-manifest` (runs automatically before dev/build:server).
- **Chat tool cards follow the runtime, not Claude**: `src/components/chat/tools/configs/toolConfigs.ts`
  is keyed by the tool's own lowercase name (`bash`, `read`, `edit`, `todo_write`), and
  its accessors read the runtime's parameter schema. `server/gjc-tool-configs.bun.test.ts`
  checks both halves against the live `@gajae-code/coding-agent` catalog, including which
  fields each accessor touches.

## Conventions

- Conventional Commits, enforced by commitlint (`@commitlint/config-conventional`,
  husky `commit-msg`) — imperative present tense, types:
  feat/fix/perf/refactor/docs/style/chore/ci/test/build/revert.
- Husky `pre-commit` runs lint-staged (eslint on staged src/server/shared/scripts).
- Commits are expected to pass `npm run verify` (the repo's promotion gate).
- **Git operations belong to the agent, not the human.** Staging, committing,
  pushing and opening PRs are the agent's job — finishing a change means it is
  committed and pushed, not left dirty in the worktree for someone else to
  handle. Do not ask permission to commit work you were asked to do; land it and
  report what landed. This includes finishing off work already in the worktree
  when asked to (fix its lint, commit it, push it).
- Other people work in this repository. Never revert, stash, `git checkout --`,
  `git clean` or commit over changes you did not make without being told to.
  When a file mixes your edit with someone else's, stage only your own hunks.
- Never commit platform/runtime artifacts: `dist-native/`,
  `src-tauri/{target,binaries,resources/server-payload}`, `.gjc-worktrees/`,
  `dist/`, `dist-server/`, `release/`.

## Key docs

- `docs/V2-SESSION-HANDOFF.md` — current project status and how to resume work.
- `server/GJC-LIVE-SPEC.md` — GJC provider/worker contract.
- `docs/DESKTOP-TAURI-VERIFICATION.md` — desktop packaging/verification (incl. the
  human-gated notarization step).
- `docs/SELF-HOST.md`, `CONTRIBUTING.md` — install/update lifecycle and PR rules.
