# GJC live provider specification

Status: Checkpoints A and B complete; Checkpoint C native-host, watcher, durable jobs, and native PTY slices implemented (2026-07-17)

GJC is the only provider routed through an isolated provider worker. Claude,
Codex, Cursor, and OpenCode retain their existing execution paths.

## Headless GJC contract

The worker invokes:

```text
gjc -p --mode json --session-dir <dir> [-r <providerSessionId>] [--model <model>] @<private-prompt-file>
```

- `cwd` is the selected project path.
- The prompt is written to an owner-readable temporary file and passed by
  `@file`; it is never placed verbatim in the process list.
- `GJC_NOTIFICATIONS=0` disables notifications from the ephemeral CLI harness.
  Gajae App remains the notification owner.
- `--session-dir` isolates session writes. Authentication and configuration
  still come from the user's normal GJC configuration.
- Stdout is byte-bounded NDJSON. Stderr is diagnostic only and is not forwarded
  to browser clients as raw provider output.
- The optional loopback SDK v3 side channel supplies controlled questions,
  replies, token usage, and `turn.abort`. If discovery or handshake fails, the
  existing NDJSON stream and process-signal abort path remain available inside
  the worker.

## Production boundary

### Application process

`server/gjc-worker-client.ts` is the only production GJC execution facade used
by `server/index.js` and `server/routes/agent.js`. It owns:

- one lazily started, long-lived native-core and worker generation;
- application session scope and immutable run IDs;
- browser-facing normalized events, replay sequencing, and provider-session
  persistence through `ChatSessionWriter`;
- the synchronous mirror of pending controlled questions;
- run notifications and explicit failed-turn fallback;
- generation restart, request timeout isolation, graceful shutdown, and
  process-tree escalation.
- one supervised native GJC transcript watcher with bounded restart backoff.

There is no direct in-process or direct-Node-worker production fallback. A
missing or failed native core, malformed output, or worker exit fails active GJC
runs explicitly; a later run starts a fresh generation only after cleanup is
proven.

### Native core process

`native/gajae-core` is a minimal Rust runtime with two strict modes. The
application starts `dist-native/gajae-core -- <worker>` to host exactly one
trusted Node worker without a shell, and starts `dist-native/gajae-core watch`
for GJC transcript changes. In process-host mode, the core:

- inherits the application-controlled environment and working directory;
- forwards application stdin to worker stdin without interpreting Protocol v1;
- gives the worker byte-transparent stdout/stderr pipes and waits for its exit;
- propagates deterministic child exit status and emits only fixed diagnostics;
- has no listener, database, provider logic, persistence, or independent restart
  policy.

Source development builds the core before startup. Release artifacts contain the
host-native executable and do not require an installed Rust toolchain. Failure to
build, locate, or launch the core is fail-closed; Node never launches the worker
directly.

### Native GJC session watcher

`server/modules/providers/services/gjc-session-watcher.service.ts` starts
`gajae-core watch` over the persisted `~/.gjc/agent/sessions` root and the
configured live-session root before the initial provider scan. The watcher:

- rejects missing, relative, duplicate, symlink, or non-directory roots;
- attaches all roots recursively before emitting its exact ready frame;
- canonicalizes event targets and emits only UTF-8 `.jsonl` `add`/`change` paths
  whose resolved filesystem identity remains inside a configured root over a strict
  64 KiB Protocol 1 NDJSON stream;
- uses bounded native and Node queues, serial cancellable callback delivery, fixed
  path-free diagnostics, and stdin EOF for owner shutdown;
- restarts with bounded exponential backoff, runs a GJC-only reconciliation after
  each replacement is ready, and never falls back to a Node/Chokidar GJC watcher.

The existing GJC TypeScript synchronizer remains responsible for defense-in-depth
realpath containment, subagent filtering, JSONL parsing, session database upserts,
and browser `session_upserted` events. Claude, Codex, Cursor, and OpenCode retain
their existing Chokidar watchers unchanged.

### Native job authority

`gajae-core jobs --database <absolute-path>` is a separate strict 64 KiB
Protocol 1 NDJSON API and the single state-machine authority for durable jobs.
Its state and ordered event replay persist in a dedicated Rust-owned SQLite
database built with bundled SQLite. Rust exclusively owns its version table and
sequential migrations; Node must not open this database. Invalid paths, unknown
schema versions, migration failures, or corrupt state fail closed. Explicit
transitions remain fenced by monotonically generated owner leases, and startup
reconciliation moves persisted active jobs to `interrupted`. Native Git/worktree
APIs, the TypeScript `JobOrchestrator`, and its admission saga are landed
components only: production GJC execution remains on the single-turn worker
facade. Automatic capacity dispatch, multi-turn continuity, and branch/PR work
from managed worktrees are deferred to Slice 3. Worker Protocol v1 and all React
behavior are unchanged.

### Native PTY lifecycle

`gajae-core pty -- <program> [args...]` owns exactly one native PTY child and
launches it directly without shell interpretation. Its separate Protocol 1
NDJSON control stream is capped at 64 KiB per frame; binary input/output uses
bounded base64 payloads, resize dimensions are validated, and output, exit,
stdin EOF cleanup, and explicit shutdown are observable. The existing
browser-shell `node-pty` path has not moved in this slice, so React and current
terminal behavior remain unchanged.

### Worker process

`server/gjc-worker.ts` is a private Node/TypeScript executable. It owns:

- GJC CLI process creation and NDJSON normalization through
  `spawnGjcWithRuntime`;
- GJC SDK discovery, authentication, controlled asks, usage, and abort;
- start/resume completion ordering and provider-session discovery;
- draining or aborting active runs when shutdown, stdin EOF, or protocol failure
  occurs.

The worker does not own or mutate application database, browser WebSocket,
replay, or notification state.

### Identity model

Three IDs are intentionally separate:

1. `appSessionId` is the stable Gajae App session and protocol scope.
2. `runId` is generated for every start/resume request and is the immutable
   abort/event correlation handle.
3. `providerSessionId` is the native GJC session used for resume and history.

Every run event carries `sessionId: appSessionId` in the envelope and `runId` in
its payload. `session.created` adds `providerSessionId`. Late events for an old
run are ignored even when a new run reuses the same application session.

## Protocol v1

`server/gjc-worker-protocol.ts` is the source of truth. Transport is private
stdio NDJSON with a strict 64 MiB maximum frame size.

```json
{
  "protocolVersion": 1,
  "kind": "request",
  "id": "run-or-request-id",
  "sessionId": "application-session-id",
  "method": "session.start",
  "payload": {}
}
```

Global `worker.initialize` and `worker.shutdown` frames omit `sessionId`.
Supported scoped requests are `session.start`, `session.resume`, `turn.start`,
`turn.abort`, and `ask.reply`. Events are `session.created`, `message.delta`,
`message.completed`, `tool.started`, `tool.completed`, `ask.presented`,
`usage.updated`, `turn.completed`, `turn.failed`, and `worker.status`.

The codec rejects unknown fields, methods, unsafe identifiers, incompatible
versions, invalid JSON values, mismatched responses, oversized or unterminated
frames, and unknown response IDs. Pending requests fail when the worker exits.
Diagnostics and protocol errors use fixed safe text; supplied secrets are
redacted recursively by the serializer.

## Process and terminal lifecycle

- On POSIX (Linux and macOS), the application starts the Rust core as a detached
  process-group leader. The Node worker and GJC children inherit that group;
  reaping requires direct-child close and process-group `ESRCH`.
- Windows is a v2 non-target and runtime-frozen per this brief: CI and a
  verified desktop machine are unavailable. No `taskkill /T /F` fallback is
  part of the v2 contract. Windows cleanup is fail-closed as `unconfirmed`, so
  it cannot release a lease or admit a replacement generation.
- A start/resume response remains pending until the GJC run settles and all
  earlier worker events have been emitted.
- `turn.abort` targets `runId`; the worker time-bounds the SDK attempt before
  direct child-signal fallback. The application marks a run aborted only after
  the worker confirms `aborted: true`; failed or timed-out aborts leave it active.
- Exactly one terminal browser event is forwarded. If the worker dies before
  producing one, the application emits one sanitized error and one failed
  completion.
- Usage enrichment, SDK bridge closure, and installation probes are bounded;
  `complete` remains the final run event even when optional dependencies stall.
- Application shutdown sends `worker.shutdown`, waits for bounded run drain,
  then terminates the owned worker tree.

## Verification contract

Focused coverage is in:

- `server/gjc-cli.test.ts`
- `server/gjc-sdk-client.test.ts`
- `server/gjc-sdk-bridge.test.ts`
- `server/gjc-core-host.test.ts`
- `server/modules/providers/tests/gjc-session-watcher.test.ts`
- `native/gajae-core/src/lib.rs`
- `server/gjc-worker-protocol.test.ts`
- `server/gjc-worker.test.ts`
- `server/gjc-windows-job.test.ts`
- `server/gjc-worker-client.test.ts`
- `server/modules/websocket/tests/chat-run-registry.test.ts`

Coverage includes start/resume, split and bounded worker NDJSON, SDK asks and
replies, timeouts, abort fallbacks, terminal races, malformed worker output,
response correlation, stale-run isolation, worker restart, native-core byte
relay and no-fallback launch behavior, real worker initialize/shutdown through
Rust, recursive multi-root transcript watching, strict watcher framing,
coalescing, ready/exit timeouts, bounded drain, graceful process drain, atomic
Windows Job Object launch, failed cleanup admission blocking, and process-tree
cleanup. Full repository verification includes Cargo fmt, Clippy, and tests and
must continue to pass on supported Node.js 22 and 24 source runtimes.
