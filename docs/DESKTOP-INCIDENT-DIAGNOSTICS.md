# Desktop incident diagnostics and reproduction

Scope: evidence only. This document describes what the desktop shell and the
server now record for a failed start, stop or native-client fault, how to read
it, and how to reproduce the known failure shapes deterministically. It does
not change recovery behaviour — see [Findings deferred to PR-02](#findings-deferred-to-pr-02).

## What already existed (do not rebuild it)

- `src-tauri/src/updater_restart.rs` already emitted structured per-stage JSON
  records through a hardened private writer. That writer is now shared, not
  duplicated: `diagnostics::append_bounded`.
- `src-tauri/src/lifecycle.rs` already fenced spawn/Quit, tracked the owned
  PID, and refused Retry while an exit was unconfirmed.
- `src-tauri/src/supervisor.rs` already bounded supervised server output to
  64 KiB (`OutputRing`) and showed it on the recovery screen.
- `server/services/server-listener.ts` already rejected startup on EADDRINUSE
  instead of letting it escape as an unhandled `ws` error.
- `src-tauri/src/build_info.rs` already exposed build identity through
  `--desktop-build-info`.

The additions below extend these. They do not replace them.

## Record 1: desktop startup/shutdown

Written by `src-tauri/src/diagnostics.rs`.

- **Location**: `<desktop data root>/desktop-startup.jsonl`, plus the same line
  on the shell's stderr.
  - Release/desktop: `~/Library/Application Support/<app bundle id>/desktop-startup.jsonl`
  - QA profile: `<qa home>/.gajae-app/desktop-startup.jsonl`
- **Bound**: 64 KiB, truncating. Mode `0600`, `O_NOFOLLOW`, refuses non-regular,
  hard-linked or foreign-owned files.
- The app-local root is created and validated before the first lifecycle record;
  an existing root must be a real, owner-controlled directory.
- **Never blocks**: the writer uses `try_lock` and skips rather than waiting.

One JSON object per line:

| field | meaning |
| --- | --- |
| `runId` | random per app process; ties one launch's records together |
| `generation` | supervised-start attempt: 1 on launch, +1 per accepted Retry |
| `stage` | `start-requested`, `origin-resolved`, `sidecar-spawned`, `ready`, `failure`, `shutdown-requested`, `shutdown-settled` |
| `category` | fixed failure vocabulary (below), `null` outside `failure` |
| `messageBytes` | length of the operator-visible message; the text is never stored |
| `shellPid` / `serverPid` | desktop shell and owned sidecar identity |
| `requestedPort` | what the desktop asked the server to bind (`0` = OS-assigned, `null` = not yet known) |
| `listeningPort` | what the verified server reported listening on |
| `productVersion`, `desktopVersion`, `updateMode`, `debug`, `os`, `arch` | build/runtime identity |
| `elapsedMs`, `timeMs` | time since process start, and wall clock |

Failure categories are closed: `startup_cancelled`, `startup_timeout`,
`identity_verification_failed`, `server_exited_early`, `server_output_closed`,
`sidecar_stream_failed`, `sidecar_spawn_failed`, `payload_unverified`,
`desktop_origin_invalid`, `credential_unavailable`, `navigation_failed`,
`cleanup_unconfirmed`, `shutdown_failed`, plus `unclassified`.

A blocking shutdown writes `shutdown-settled` only after the sidecar exit is
confirmed. If its bounded wait expires, it writes a `shutdown_failed` failure
instead and does not claim that shutdown settled.

Reading a suspected port incident:

```bash
# newest first, one launch per runId
tail -n 200 ~/Library/Application\ Support/*/desktop-startup.jsonl | tail -r
```

`requestedPort` vs `listeningPort` is the load-bearing comparison. A
`requestedPort` of `60278` with no `ready` record and a `sidecar_spawn_failed`
or `server_exited_early` failure is the EADDRINUSE shape.

### What is deliberately not recorded

No message text, no supervised server output, no environment, no filesystem
paths, no URLs, no credentials, no cookies, no page content, no command
arguments. A failure is reduced to one fixed category plus a byte count.

## Record 2: native client (gajae-core) evidence

`server/services/gjc-native-diagnostics.ts`, consumed by
`server/services/gjc-git-client.ts`.

`GJC native client is unavailable.` is a single generic string used for spawn
failure, readiness timeout, child exit, stream error and every protocol fault.
That message is **load-bearing** — `GjcJobsClient.request` matches it exactly to
produce `authority_unavailable` — so it is unchanged. The evidence it used to
erase is now carried alongside it.

- The thrown error is a `GjcNativeUnavailableError` with the identical
  `message`, plus `category` and `evidence`.
- `GjcJobsClient` rethrows `GjcJobsClientError` with the same message and code,
  attaching the original as `cause`.
- `client.evidence()` returns the same bounded ring at any time.

Stages: `spawn`, `spawn_failed`, `ready`, `ready_timeout`, `exit`,
`protocol_error`, `stderr`, `restart_scheduled`, `closed`. Bounded to 32
records, each detail truncated to 200 characters.

Two gaps this closed:

- A **throwing** spawn (missing or non-executable `gajae-core`) previously
  vanished into `catch { this.failed(); }` with no record at all.
- The native binary's **stderr was subscribed nowhere**, so panics were
  discarded. It is now recorded with absolute filesystem paths replaced by
  `<path>`.

## Reproduction fixtures

All deterministic, isolated, and hermetic. No fixture starts a real
`gajae-core`, kills a real process, or reads a developer's browser profile.

| # | Scenario | Location |
| --- | --- | --- |
| 1 | Desktop port owned by an unrelated listener | `server/services/server-listener.test.ts` — "reproduction: an unrelated listener owning the desktop port…" |
| 2 | Native client spawn failure | `server/services/gjc-native-diagnostics.test.ts` — "fixture: native client spawn failure…" |
| 3 | Native client readiness timeout | `server/services/gjc-native-diagnostics.test.ts` — "fixture: native client readiness timeout…" |
| 4 | Repeated Retry attempts | `server/services/server-listener.test.ts` — "reproduction: repeated retries…"; `src-tauri/src/diagnostics.rs` — `repeated_retry_attempts_stay_individually_attributable` |
| 5 | Lifecycle/shutdown diagnostic preservation | `src-tauri/src/diagnostics.rs` — `shutdown_progress_survives_a_failed_startup_in_the_same_log`, `startup_creates_a_missing_root_before_the_first_record`; `src-tauri/src/lifecycle.rs` — `blocking_shutdown_wait_reports_an_unconfirmed_timeout` |

Run them:

```bash
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test \
  server/services/server-listener.test.ts \
  server/services/gjc-native-diagnostics.test.ts
cargo test --manifest-path src-tauri/Cargo.toml diagnostics
```

## Why one failure can appear several times

Confirmed by `server/services/server-listener.test.ts` — "investigation: one
bind refusal is delivered twice…".

`ws` re-emits the HTTP server's `error` event on the `WebSocketServer`
(`node_modules/ws/lib/websocket-server.js`, `error: this.emit.bind(this, 'error')`).
A single OS-level bind refusal is therefore delivered to two emitters as the
**same `Error` instance**. The test asserts object identity and asserts that
zero listeners were established.

Independently, each Retry produces its own identical refusal.

**Duplicate log lines are not evidence that two servers were spawned.** Only
process evidence (below) can establish that.

## Operator checklist: installed-app investigation

Read-only. Nothing here terminates, signals or modifies a process. Do not kill
a process merely because it owns a port.

1. **Installed build identity**

   ```bash
   /Applications/<App>.app/Contents/MacOS/<binary> --desktop-build-info
   /usr/bin/plutil -p /Applications/<App>.app/Contents/Info.plist | grep -i version
   ```

2. **Diagnostic records**

   ```bash
   ls -l ~/Library/Application\ Support/*/desktop-startup.jsonl
   tail -n 100 ~/Library/Application\ Support/*/desktop-startup.jsonl
   tail -n 100 ~/Library/Application\ Support/*/updater-restart.jsonl
   cat  ~/Library/Application\ Support/*/desktop-port      # the remembered origin
   ```

3. **Listener identity — who actually owns the port**

   ```bash
   lsof -nP -iTCP:60278 -sTCP:LISTEN          # PID, command, user
   lsof -nP -iTCP -sTCP:LISTEN | grep -i gajae
   ```

   Record the PID, the command, and the owning user. An occupied port is not
   proof that the occupant is ours.

4. **Process ancestry and start time**

   ```bash
   ps -o pid,ppid,lstart,user,command -p <PID>
   ps -o pid,ppid,lstart,user,command $(pgrep -f gajae)
   ```

   Compare `lstart` against the incident time and against the shell's own start
   time. A listener older than the current shell was not started by it.

5. **Parent/child relationship**

   ```bash
   pstree -p <shell PID>        # if installed
   ps -o pid,ppid,command -ax | awk '$2 == <shell PID>'
   ```

   The shell's owned sidecar appears as a direct child. A listener that is not
   a descendant of the running shell is foreign to it.

6. **Original crash report**

   ```bash
   ls -lt ~/Library/Logs/DiagnosticReports/ | head -20
   open -R ~/Library/Logs/DiagnosticReports/<name>.ips
   ```

   The crash report's `Exception Type`, faulting thread and timestamp are the
   only direct evidence of the original exit cause. Correlate its timestamp
   with the `runId`/`generation` in `desktop-startup.jsonl`.

7. **Correlate, then conclude**

   A conclusion needs: the crash report's exit cause, the `lsof` identity of
   the port owner, that owner's start time relative to the crash, and the
   `desktop-startup.jsonl` records for the failing launch. Any subset of these
   is a hypothesis, not a root cause.

## Findings deferred to PR-02

Recorded here as findings; deliberately **not** implemented in this PR.

1. **`desktop-port` has no liveness or ownership check before it is reused.**
   `DesktopOrigin::load` (`src-tauri/src/desktop_origin.rs`) validates only that
   the file is a small regular file holding a port `>= 1024`. The supervisor
   passes it straight to the sidecar as `SERVER_PORT`
   (`src-tauri/src/supervisor.rs`). If any unrelated process has taken that
   port, every launch and every Retry fails identically with no path back to a
   working origin. A recovery design must not kill the occupant and must not
   simply abandon the stable origin (UI preferences are keyed to it).

2. **The bounded writer drops records under contention.**
   `diagnostics::append_bounded` uses `try_lock` and returns `Ok(())` when
   another thread holds it, so concurrent stages can be silently lost. This is
   the pre-existing updater-restart behaviour and was preserved deliberately.
   A short bounded blocking acquire would not risk a lifecycle stall and would
   stop losing evidence.

3. **`show_error`'s suppression can hide a failure from the user.**
   `supervisor::show_error` returns early while shutting down or while a
   sidecar is still owned. Diagnostics are now recorded *before* that gate, so
   the evidence survives, but the operator still sees nothing in those cases.

4. **Native client restart is unbounded in count.**
   `GjcNativeClient.failed` always schedules another start with a capped
   backoff (`maxRestartDelayMs`), with no attempt ceiling. A permanently
   missing `gajae-core` therefore respawns forever. The evidence ring now makes
   this visible (`restart_scheduled` records across generations).

5. **`GJC native client is unavailable.` is matched by string equality.**
   `server/services/gjc-jobs-client.ts` compares `error.message` to the literal.
   Any future change to that string silently reclassifies failures. A shared
   exported constant or an `instanceof` check would remove the trap.

None of these were changed here. This PR ends at diagnostics, reproduction and
tests.
