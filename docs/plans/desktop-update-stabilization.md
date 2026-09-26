# Desktop update stabilization

Baseline: `dd31c01` (main after PRs #79, #81 and #82), 2026-09-13.
Scope: macOS Apple Silicon. This work does not publish a release, replace the
installed app, change keys, or enable automatic downloads/restarts.

## PR 1: preserve restart failure evidence

### Report and evidence

The user reports beta.14 → beta.15: clicking **Restart to install** flashes the
window, then leaves the old app running. Read-only inspection of
`/Applications/Gajae Code App.app/Contents/Info.plist` found desktop version
`0.2.8`, matching the beta.14 source tag. The beta.15 tag uses `0.2.9`.
This is not an execution trace of the installed application's failed attempt.

Confirmed source defects, present in the old restart path:

- `disposition()` put the abort reason only in its HTTP response. `decorate()`
  did not retain that reason on subsequent status reads. A replaced document
  can lose the HTTP response and remount with a plain ready snapshot.
- `prepare_restart()` collapsed backend refusals, unknown ownership, malformed
  responses and transport failures into `updater_runtime_busy`.
- Socket read/write timeouts were flattened to backend-unavailable errors.
- Detailed stage tracing was gated on debug + QA; a Finder-launched production
  app had no dedicated bounded restart diagnostic file.
- The UI did not classify `updater_runtime_busy` as a busy refusal.

The installed failure's cause remains unconfirmed. Possible stages include the
shared five-second draft/preparation deadline, backend ownership evidence,
process capture, shutdown, and successor instance admission. No timeout was
increased, owner check removed, process forcibly killed, or install retried.

The existing Applying navigation is intentional: it retires the sealed
renderer before taking backend generation evidence. Expected HTTP/WebSocket
closures must be included in that evidence. Moving it after Prepare without a
replacement ownership protocol is not a safe minimal fix.

### Change

The native attempt retains its terminal reason across fresh status snapshots,
scoped to the same target and terminal attempt. A new admitted attempt starts
without that reason. A confirmed abort remains eligible for explicit retry
only when the existing location/backend/ownership gates allow it. Recovery
remains non-retryable and retains the uncertainty reason.

`restartAborted` remains a draft-unseal notification, not new update authority.
The replacement view retrieves the reason from authenticated native status;
no new renderer-supplied fields or protocol version are introduced. A late
cancel/ACK cannot overwrite an earlier abort's root reason.

Backend preparation now distinguishes `busy`, `unknown`, transport timeout,
transport unavailable and invalid protocol with fixed app-owned codes. Raw
backend error text is never forwarded. The sidebar/About map the codes to
localized explanations. Polling/remounting never replays a restart click.

Production traces contain only attempt ID, stage, elapsed time, source/target
versions, platform and fixed reason codes. Request admission/refusal and the
accepted draft → backend → owned shutdown → manual-intent path are logged.
They contain no prompt, transcript, token, URL, full argv or user command.
Records are written to stderr and `<desktop-data-root>/updater-restart.jsonl`
(mode 0600, capped at 64 KiB; on reaching the cap the file starts anew).
Symlinks, non-regular files and multiply linked files are refused. A diagnostic
write failure neither grants authority nor schedules a retry. The reason in
status is process-local; the file survives app exit for diagnosis.

A backend refusal additionally writes a `backend-refused` record carrying
`blockers`: the owner/code pairs the server's restart authority reported
(for example `{"owner":"orchestrator","code":"owner_unknown"}` or
`{"owner":null,"code":"ingress_busy"}`), at most 32 fixed identifiers. The
server includes the same `blockers` array in every `restartControlResult`
(empty on success); native rejects a result without it. Before this, a
refused click left only `updater_runtime_busy`/`updater_runtime_unknown` in
the journal and the owner list existed only on the server's captured stderr,
which a Finder-launched app never surfaces. 2026-09-26: every restart click
recorded on the owner's Mac since 0.2.10 (21 attempts, 0.2.10→0.2.11 through
0.2.12→0.2.14) had aborted this way; a harness replaying the backend prepare
against the same `~/.gajae-app` showed `orchestrator owner_unknown` /
`native-jobs owner_failed` / `native-clients owner_busy` because the
long-lived dev stack's `gajae-core jobs` held the exclusive
`jobs.sqlite3` lock, and a private database copy prepared cleanly. See
`AGENTS.md` (Environment).

### Verification and acceptance boundary

Regression coverage:

- Fresh native status snapshots retain the original timeout/abort reason;
  another target/active attempt does not inherit it, and recovery stays closed.
- Backend negative outcomes distinguish busy/unknown/expired/invalid; a real
  Unix socket timeout is classified and retires its channel.
- Diagnostic file privacy, bound and symlink refusal.
- English/Korean sidebar remounts retain actionable busy/unknown/timeout text.
- Busy snapshots and polling do not issue a second restart command.

Existing suites retain draft cancellation, duplicate requests, commit/cancel
races, owned-process shutdown, instance locks and journal recovery checks.
Source/native tests are not evidence of replacing a signed installed app.

For an actual package reproduction, use a disposable macOS account/VM, or the
existing QA-profile workflow in `docs/DESKTOP-TAURI-VERIFICATION.md` and
`scripts/release/MACOS-ACCEPTANCE.md`; do not run an old production app against
the user's real data. Record OS/architecture, bundle location/signing, product
and desktop source/target versions, source hashes and install method. Exercise:

1. Idle restart and an active agent/command refusal.
2. Duplicate click, a stalled/disconnected backend, and return to the app.
3. Collect the bounded diagnostic file and authenticated status after remount;
   correlate `attemptId`, stage and reason. Confirm editing remains available
   only after confirmed precommit cancellation.
4. On success, verify old PID/tree exit, successor binary version and embedded
   server readiness; compare test data before/after.
5. On commit/shutdown/install uncertainty, verify recovery without replaying
   the click. Do not treat a mock or an installer function return as success.

No signed beta.14 → beta.15 replacement or A→B package update was performed in
PR 1. The installed beta.14 cannot gain these diagnostics before it updates.
If its pre-install path is blocked, a data-preserving official DMG transition
is needed: quit the old app cleanly, install the published compatible bundle,
then verify version and existing data. Do not delete the app data or downgrade
its database. Existing feed/signature compatibility remains unchanged; no new
release is published by this PR.

## Subsequent PRs and order

1. **Failure evidence / minimum fixes (this PR).** Preserve the failure across
   navigation and distinguish refusal from internal error; document the limits.
2. **Packaged transition harness.** Extend existing QA with isolated A→B success
   and failure cases, including actual successor health and data preservation.
   Establish this baseline before restructuring lifecycle ownership.
3. **Coordinator simplification.** Remove only responsibilities demonstrably
   duplicated by the official plugin/common shutdown path. Preserve ingress
   fencing, draft seal, process ownership, signature/archive checks and journal.
4. **Non-disruptive UX.** Explain readiness and deferral on the current surface;
   evaluate how to avoid the early navigation while keeping generation evidence
   valid. Automatic downloads are a separate explicit policy choice: the current
   `automatic` preference means checks only. “Later” never schedules a restart.
5. **Release compatibility automation.** Extend existing manifest generation,
   desktop-version-floor and production-binding gates. Test A→B→C and skipped
   versions plus old-client transition, without replacing the established keys
   or confusing product versions with native versions.

Merge order: 1 → 2 → 3 → 4 → 5. Windows draft #44 and Linux desktop packaging
are not part of this stabilization sequence.

## PR 1 local validation (2026-09-13)

- `npm run verify`: passed on Node 22 with Bun 1.4.0.
- `npm run server:payload:macos`: passed, including isolated packaged-server smoke.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: final full run
  362 passed / 6 existing helper ignores; build binding 11 passed.
- Focused updater client/sidebar DOM suite: 36 passed.

One intermediate full native run failed the unchanged
`drop_and_unwind_leave_inspectable_installing_without_resumption` test while
reopening its journal (`another journal owner` lock error). The initial full
run, isolated rerun and subsequent full run passed. No retry or assertion
weakening was added to the production code or that test.

## beta.16 integration

Steps 1–5 are delivered as failure diagnostics, read-only operator evidence,
conservative native owner correction/shared target rechecks, separate restart
consent, and release-version automation. The operator explicitly defers the
actual beta.16 → beta.17 transition test; see `../DESKTOP-UPDATE-OPERATOR-TEST.md`.
The source/native and signed-package gates still apply before publication.
The shell ownership gap remains guarded and is disclosed in
`../DESKTOP-UPDATE-FAILURE-BETA14.md`; it is not claimed fixed.
