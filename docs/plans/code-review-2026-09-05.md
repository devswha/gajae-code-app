# Correctness review — 2026-09-05

Base: `c8048d9` (main after PR #33). Review and implementation used Astra
with xhigh reasoning throughout, with separate frontend, backend and native
workers. The final integration received another independent review.

## Findings addressed

| Area | Failure | Correction and evidence |
| --- | --- | --- |
| Chat streaming | A subscribed background session could append to or finalize the visible answer and replace its model/context status. | Route each event to its owning session; DOM regressions interleave two sessions and reconcile final text with disk history. |
| History navigation | Late history, pagination and token-usage responses could overwrite a later session's state, including after navigating away and back. | Scope completion to a particular visit; deferred-response DOM tests cover loading, pagination, load-all and usage. |
| Queued messages | Automatic dispatch used the current model and effort instead of the queued selection. | Carry the queued options and attachments through submission; check the emitted `chat.send`. |
| Steering | Identical steering text in different sessions shared acknowledgement state; switching sessions could leave the accepted steer queued. | Key pending acknowledgements by session and text, retain queue item identities, and update the owning queue. |
| Transcript turns | A new prompt linked to a terminal assistant remained in the preceding turn; control records split steering into a new turn. | Follow message ancestry and terminal stop reasons; verify against records produced by the pinned SDK's `appendMessage`. |
| History parsing | A JSON `null` record made lineage parsing throw, discarding a conversation's otherwise valid history. | Ignore values that are not transcript objects; integration tests mix malformed records with valid history. |
| Tool transport | Truncating folded text restored structured details already rejected for size or cyclic references. | Build the preview from the prepared result; verify bounded serialization and an untouched source result. |
| CLI shim | Shell metacharacters in runtime paths were expanded; rewriting an existing non-executable shim did not repair its mode. | Quote literal arguments and explicitly restore executable mode; execute a fixture under paths containing shell metacharacters. |
| Scratch workspace | Simultaneous starts could race through `git init` or fail creating an already-created README. | Serialize initialization per canonical directory and tolerate a competing README creation; test concurrent real Git initialization and failure recovery. |
| Desktop lifecycle | An early exit notification could be lost; Retry, startup and Quit could replace or miss the tracked server. | Serialize spawn/PID publication with shutdown, scope exits by PID, and wait on durable exit state. |
| Desktop supervisor | Output errors cleared ownership before the server exited; readiness accepted another PID. | Drain failed-child events while retaining ownership, block Retry until exit, and require the supervised PID; test an actual child that ignores SIGTERM. |
| Transcript watcher | Rescan flags and bounded-backfill overflow silently lost updates. | Exit the watcher so its parent performs full reconciliation; cover OS flags, queue overflow and scan overflow. |
| QA isolation | Parent environment or `.env` workspace/browser paths could escape the temporary QA home. | Set explicit isolated workspace, browser profile and browser cache roots; regression fails before the fix and passes after it. |
| Narrow workspace panel | At 390px, tab labels pushed the drawer close button beyond the viewport. | Let the tab strip scroll within the available width while preserving close controls; real-browser before/after screenshots and a successful close click. |

## Validation

- Focused backend suites: 271 Node tests, 77 Bun tests passed; one credentialed
  SDK smoke skipped.
- Focused frontend suites: 127 tests passed, including 15 new regressions.
- Rust core: formatting, Clippy with warnings denied, and 54 tests passed.
- Tauri: formatting, Clippy with warnings denied, and 13 tests passed.
- GJC driver/wire E2E: 7 tests passed. These exercise real HTTP/WebSocket,
  storage and Git contracts with a controlled provider, not paid model runs.
- Standalone website: 5 tests and production build passed.
- Real browser: empty workspace → Scratch → README diff expansion → New work
  item and composer focus; 390px drawer close regression fixed and rechecked.
  QA used an ephemeral home and did not send a model prompt.
- `npm run verify` passed on the integrated macOS changes: audit, licenses,
  notices, client/server typecheck, Rust checks, all tests, lint, product
  identity and production builds. Linux Node 22/24 CI results are recorded
  on the pull request.

## Follow-ups and limits

- PR #30 and issue #18 await a published SDK containing upstream PR #5282.
  Registry `latest` remained `0.16.3`; the app's pin remains `0.15.6`.
  Issue #3's skill matrix should run after that update.
- CI signing has no credentials in the `release` environment yet. Local
  notarized releases exist; a signed CI release was not dispatched here.
- The existing five-second steering fallback can still duplicate a follow-up
  when an acceptance arrives after timeout and dispatch. Eliminating that
  ambiguity requires an end-to-end request identity/acknowledgement contract.
- Scratch initialization serialization is process-local. The desktop changes
  were checked on macOS, including real child-process tests, but a new packaged
  GUI/notarization drill and Windows execution were not performed.
- Worktree selection, conversation forks and split panes retain their existing
  upstream dependency or deliberate product deferral; see the session handoff.
