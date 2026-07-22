# GJC desktop architecture roadmap

Status: implementation record and forward roadmap
Recorded: 2026-07-15

Implementation progress:

- **Checkpoint A complete.** GJC CLI/SDK lifecycle behavior is covered with
  injectable fake-child, controlled-ask, abort, disconnect, timeout, terminal
  race, and cleanup tests. Protocol v1 lives in
  `server/gjc-worker-protocol.ts` with strict 64 MiB NDJSON frames, response
  correlation, scope validation, and supplied-secret redaction.
- **Checkpoint B complete.** Production GJC starts and resumes cross one
  long-lived Node/TypeScript worker behind `server/gjc-worker-client.ts`.
  `server/gjc-worker.ts` owns the GJC CLI/SDK runtime; the application retains
  browser sockets, application session IDs, replay, persistence, notifications,
  permission mirrors, restart policy, and terminal reporting.
- **Checkpoint C slice 1 complete.** `native/gajae-core` is now the mandatory,
  minimal Rust process host between the application and Node GJC worker. It
  launches exactly one trusted worker without a shell, preserves Protocol v1
  bytes, waits for worker exit, and has no direct Node fallback.
- **Checkpoint C slice 2 complete.** GJC transcript watching now runs through
  `gajae-core watch` for the persisted and live-session roots. The Rust watcher
  attaches recursively before its ready frame, emits only bounded, canonically
  contained `.jsonl` add/change events, and exits with its application-owned stdin.
  The Node client strictly validates and coalesces those events, cancels queued work
  during bounded shutdown, restarts with bounded backoff, reconciles GJC after each
  replacement, and has no Chokidar fallback.
- **Checkpoint C slice 2 components landed.** `gajae-core jobs` and native
  Git/worktree APIs provide the durable state-machine authority, fenced lease
  generations, explicit transitions, crash reconciliation to `interrupted`, and
  ordered idempotent event replay. The TypeScript `JobOrchestrator` admission
  saga is verified as a component; it is not production execution wiring.
  Durable authority state lives in a separate Rust-owned SQLite database using
  `rusqlite` with bundled SQLite, sequential fail-closed migrations, and
  atomic persisted mutations.
- **Checkpoint C slice 5 complete.** `gajae-core pty` owns one native PTY child
  without a shell and exposes bounded base64 input/output, validated resize, exit,
  EOF cleanup, and explicit shutdown over a separate strict 64 KiB NDJSON API.
- Process ownership remains explicit: the Rust core is the detached POSIX
  process-group leader and the worker/GJC descendants stay attached. On Windows,
  the existing live-owner guard creates the Rust core atomically inside a
  kill-on-close Job Object; descendants inherit it. Cleanup failure remains
  fail-closed before replacement.
- Source builds require the pinned Rust toolchain. Server release artifacts carry
  the host-native core executable and require no installed Rust toolchain.
- **v2 completion record (2026-07-20).** Everything below through Checkpoint D is
  implemented and shipped (releases 1.1.0–1.3.0):
  - Slice 3 (durable jobs production wiring, multi-turn continuity, managed
    worktrees), Slice 4 (projection + web UI + notification adapter), Slice 5
    (Tauri desktop shell), and Slice 6 (clone wizard) are complete.
  - **Electron was removed (C9, wave1).** The desktop shell is Tauri-only:
    Rust supervisor owns the Node server sidecar (spawn → ready frame →
    /health identity → WebView bootstrap), single-instance flock with clean
    second-launch exit, hide-on-close keeps jobs alive, every quit path —
    including the macOS Quit AppleEvent that bypasses a preventable
    ExitRequested — runs a bounded synchronous sidecar shutdown fence, a
    CSP-safe recovery Retry respawns the sidecar, and validated
    `gajae-app://open/job/<id>` deep links navigate the SPA.
  - The C7 interactive GUI smoke was completed 2026-07-20, driven end-to-end
    through gjc computer use (evidence: `artifacts/g002/`,
    `docs/DESKTOP-TAURI-VERIFICATION.md`). It surfaced and fixed four real
    shell defects (9bdc18d, 60b26b6, ef6f076, 2e584b9+36d7cb2).
  - Jobs authority schema is at v6: `jobs.prompt` persisted at reserveStart,
    `createdAt`/`prompt` projected to snapshots, and `job.list` is
    byte-budgeted (48 KiB) with `nextCursor` keyset pagination; list prompts
    are display-truncated to 256 chars while `job.get` keeps the full prompt.
  - **Amendment to confirmed decisions 5–7 (2026-07-20):** the GJC-only
    cleanup waves removed the non-GJC provider lanes (Claude/Codex/Cursor/
    OpenCode), the web-push/PWA stack, the tmux mirror lane, and the
    multi-user auth stack (desktop-key auth only). v1 users are served by the
    frozen snapshot repository `devswha/gajae-app-v1` (cut at v1.0.0).
  - Remaining: Developer ID signing + notarization (human gate), and a Linux
    x64 verify rerun for this session's commits (gated on macOS arm64 only).

## Purpose

Record the agreed direction for evolving Gajae App toward a Codex App-like desktop product without turning the recent Node.js compatibility fix into an unnecessary full rewrite.

## Confirmed decisions

1. Source development supports Node.js 22.22.2+ within 22.x and 24.15.0+ within 24.x. The immutable production server artifact remains pinned to Node.js 22 until its release contract is changed separately.
2. A full Rust rewrite is not justified solely by Node.js installation or engine-version friction.
3. Rust is the preferred long-term core for desktop lifecycle, local process supervision, PTY ownership, durable jobs, Git/worktree operations, file watching, and native distribution.
4. The React UI remains reusable and must communicate through explicit APIs rather than directly owning filesystem, Git, database, or child-process behavior.
5. GJC is the only provider that will use the provider-worker architecture initially.
6. Claude, Codex, Cursor, and OpenCode keep their existing integration paths. They are not part of the first worker extraction and must not be forced behind a speculative generic worker abstraction.
7. The first GJC worker is the reference implementation. Other providers move only after a concrete need and a separately approved scope.

## Target shape

```text
Desktop shell (Tauri — shipped; Electron removed 2026-07-19, C9/wave1)
                         |
                      React UI
                         |
              existing application API
                         |
       Rust local core/daemon (incremental target)
       |        |         |        |        |
     Git      PTY      jobs     SQLite   file watch
                         |
                GJC worker client
                         |
              local versioned IPC
                         |
                GJC provider worker
                         |
                     GJC SDK/CLI
```

The desktop shell must stay thin. Closing a window must not implicitly destroy a durable agent job once the daemon architecture exists.

## GJC-only worker boundary

### Worker owns

- GJC SDK discovery, authentication, handshake, and protocol compatibility checks.
- GJC session start and resume operations.
- Turn start, streaming, controlled questions, replies, and abort.
- GJC token-usage and status events.
- GJC-specific error normalization before crossing IPC.
- Secret handling for SDK endpoint tokens; secrets must never enter observer events or logs.

### Application server/core owns

- Gajae App authentication and authorization.
- Application session IDs and provider-session ID mapping.
- Database writes and migrations.
- Browser WebSocket connections and replay sequencing.
- UI-facing normalized message events.
- Permission policy, job state, persistence, and recovery decisions.
- Worker startup, health checks, restart policy, and terminal failure reporting.

### Worker must not own

- Direct writes to the Gajae App database.
- Browser authentication or browser-facing sockets.
- Product-wide provider registration.
- Claude, Codex, Cursor, or OpenCode behavior.
- UI component state.

## Initial IPC contract

The default implementation direction is private local stdio with newline-delimited JSON. It avoids opening another network listener and is sufficient for one supervised GJC worker. A different transport requires a concrete operational reason.

Every frame should carry:

```json
{
  "protocolVersion": 1,
  "kind": "request | response | event",
  "id": "request-or-event-id",
  "sessionId": "application-session-id",
  "method": "turn.start",
  "payload": {}
}
```

Minimum request methods:

- `worker.initialize`
- `session.start`
- `session.resume`
- `turn.start`
- `turn.abort`
- `ask.reply`
- `worker.shutdown`

Minimum event families:

- `session.created`
- `message.delta`
- `message.completed`
- `tool.started`
- `tool.completed`
- `ask.presented`
- `usage.updated`
- `turn.completed`
- `turn.failed`
- `worker.status`

The protocol must reject unknown incompatible versions, correlate every response, bound frame size, redact secrets, and fail pending requests when the worker exits.

## Existing extraction points

The current GJC implementation already contains the boundary candidates:

- `server/gjc-cli.js`: GJC CLI process lifecycle and NDJSON handling.
- `server/gjc-sdk-client.ts`: SDK connection, request correlation, and protocol handling.
- `server/gjc-sdk-bridge.ts`: controlled asks, abort, token usage, and server integration.
- `server/modules/providers/list/gjc/`: read-only provider facets and session synchronization.
- `server/routes/agent.js` and `server/index.js`: application wiring and abort routing.
- `server/GJC-LIVE-SPEC.md`: current live-provider behavior and verification constraints.

Extraction must preserve the existing observable GJC behavior before responsibilities move into Rust.

## Migration checkpoints

### Checkpoint A: freeze behavior contracts — complete

- Capture the current GJC start, resume, stream, ask/reply, usage, abort, disconnect, and error behavior in focused tests.
- Keep all existing providers unchanged.
- Define the versioned IPC schema and maximum frame sizes.
- Define ownership of application IDs versus GJC session IDs.

### Checkpoint B: extract the GJC worker — complete

- Move GJC SDK/CLI connection behavior behind the worker boundary.
- Keep the existing Node application server as supervisor and API owner.
- Preserve current browser events and database behavior.
- Surface worker crashes as explicit failed turns; do not silently fake completion.

### Checkpoint C: introduce the Rust core — in progress

Slices 1 through 5 and the Slice 2 job components are complete:

- Route only the GJC Node worker launch through the mandatory Rust process host.
- Keep Protocol v1 opaque to Rust and authoritative in TypeScript.
- Package and smoke the native executable with the server artifact.
- Preserve React, application state, and all non-GJC provider paths.
- Route GJC persisted/live transcript watching through a separate parent-owned
  native watcher process with a strict 64 KiB NDJSON protocol and resolved-path
  containment.
- Preserve the existing TypeScript synchronizer, database upserts, WebSocket
  deltas, initial scan, restart reconciliation, and every non-GJC Chokidar watcher.
- Land native Git/worktree APIs, durable job persistence, and the typed
  `JobOrchestrator` admission saga as verified components.
- Add a native single-child PTY lifecycle API with bounded framed I/O, resize,
  exit reporting, and owner-driven shutdown.

Slice 3 is complete (production wiring, multi-turn continuity, managed-worktree
branch/PR flow, and capacity handling shipped in 1.1.0; see the v2 completion
record above).

### Checkpoint D: thin desktop shell

- **Resolved (2026-07-19/20):** Tauri shipped as the only shell; Electron was removed after the Tauri build passed the packaged smokes, and the C7 GUI smoke closed on 2026-07-20.
- Make window lifecycle independent from durable daemon jobs.
- Embed or serve the built React assets without requiring end users to install a development Node.js toolchain.

## Product invariants

A Codex App-like direction requires more than changing implementation language:

- Agent jobs survive UI reconnects and expose deterministic terminal states.
- Each worktree/job has explicit ownership and cleanup rules.
- Diffs remain reviewable before commit or application.
- Abort is real and observable, not a UI-only state change.
- Event replay is ordered and idempotent.
- The daemon fails closed around project paths, credentials, and remote exposure.
- No migration may regress the existing GJC session history or live-run behavior.

## Non-goals

- Rewriting the whole server in Rust in one change.
- Replacing the React UI.
- Moving every provider to a worker.
- Removing existing providers.
- Claiming a single binary while silently requiring an unmanaged external runtime.
- Changing the Node.js 22 production artifact contract as part of the GJC worker extraction.

## Open decisions

These require implementation evidence or a separate approved plan:

- The implemented reference uses one long-lived TypeScript/Node worker per
  application server. A different topology requires measured evidence.
- Protocol v1's current source of truth is
  `server/gjc-worker-protocol.ts`; a TypeScript/Rust code-generation mechanism
  remains open for Checkpoint C.
- **Resolved (2026-07-17):** Rust uses `rusqlite` with bundled SQLite. Durable
  jobs use a separate daemon-data database whose schema and sequential
  migrations are owned exclusively by Rust; Node must not open that database.
- **Resolved (2026-07-19):** Tauri-only on macOS arm64 today; Linux packaging remains future work.
- Packaging strategy for any runtime still required by the GJC SDK.
