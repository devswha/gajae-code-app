# Session worktree selection: SDK 0.16.4 assessment

Status: the app now offers **Project / New worktree** before conversation
creation. A managed session uses a native job bound to its app session and
retains its checkout across turns and server restarts. SDK 0.16.4 already has
the relevant lifecycle surfaces; no future SDK or unpublished "Slice 3" is
required. Commit `8a22e10` closed the native continuation validation gap before
the picker was connected.

This is a scoped follow-up to the run-location item in
[`V2-SESSION-HANDOFF.md`](../V2-SESSION-HANDOFF.md) and the deferred decisions in
[`local-studio-ui-adoption.md`](local-studio-ui-adoption.md). It does not reopen
the completed phases or change the SDK pin owned by PR #30.

## Evidence from the published package

Inspected the npm tarball for `@gajae-code/coding-agent@0.16.4`, including its
package exports, `dist/types`, and matching `src` files. The relevant public
imports are:

| Public surface | What it supports | Consequence for this app |
| --- | --- | --- |
| `sdk/session` → `createAgentSession` | `CreateAgentSessionOptions.cwd` and an optional `SessionManager`; no worktree lifecycle option | This is the app's current in-worker execution path. Supplying a different cwd does not acquire a worktree or coordinate its ownership. |
| `session/session-manager` → `SessionManager.moveTo` | Moves the transcript/artifacts and changes the session cwd, with exclusive transition and publication listeners | This is a session move, not worktree allocation/acquisition. Using it needs worker resource rebinding and persisted project/cwd separation. |
| `sdk/lifecycle/service` → `SessionLifecycleService` | Create, resume, and fork targets include `worktree: { enabled: true, name?: string }`; actor, capability, and request key are explicit | The SDK can represent the feature. Its lifecycle client must actually implement the operation. |
| `sdk/lifecycle` → `createSessionLifecycleService` | Default broker transport; `createExternal` accepts `{ kind: 'worktree', repo, branch }` | This creates a broker-managed session host, not a worktree handle for an existing in-process session. |
| Lifecycle result | Provider `sessionId`, optional actual `cwd`, endpoint generation, reuse/note information; typed terminal/retryable/cleanup/uncertain failures | Persist the returned identity and validate the actual cwd. Do not substitute the source repository when cwd is absent. |
| `cli/worktree-cli` and `commands/worktree` | Tombstone modules for removed legacy operations | Their presence in the export map is not an available picker/list/cleanup API. |

The `sdk` barrel also exports the `lifecycle` namespace. The documented
subpaths above are public under the package export map. The package explicitly
blocks direct imports of `sdk/broker/*`, `sdk/client/*`, and
`sdk/lifecycle/broker-client`; implementation inspection does not authorize
depending on those private modules.

The default lifecycle client ensures a broker, discovers its authenticated
endpoint, and sends `session.create`. In the packaged
`src/sdk/broker/lifecycle.ts`, worktree preparation and occupancy checks precede
spawning a detached session host. `readiness: 'deferred'` still takes that
spawn path; it changes the ready milestone, not ownership of the session.
Calling it and then opening the same transcript through the existing Bun
adapter would introduce two execution owners.

The lower-level `gjc-runtime/launch-worktree` helper is not an equivalent
shortcut. Its own occupancy module documents that `ensureLaunchWorktree`
can reuse a checkout without checking its session occupant. Preparation also
contains stale-entry pruning and detached-checkout movement. Extracting that
helper into an Express route would omit the broker's lifecycle guarantees.

## Current application boundaries

The following describes the foundation inspected before this implementation;
the changes and executable acceptance coverage are recorded below.

- `native/gajae-core/src/git.rs` dispatches job worktree create/list/status/diff/
  prune. Creation requires `jobId`, `branch === job/<jobId>`, and the matching
  `<repo>/.gjc-worktrees/<jobId>` path. Listing filters to that namespace;
  it is not a general registry of session worktrees. Registered Git-pointer
  validation and dirty/ignored-file preservation belong to this native path.
- `server/services/gjc-job-orchestrator.ts` reserves a job, prepares the native
  worktree, records repository root/base/branch, admits a run, and dispatches
  with the worktree cwd. `turnStart` uses the app-session binding and retained
  provider identity; `resume` uses its persisted job identity and worktree.
  These are real multi-turn primitives, also exposed by `routes/gjc-jobs.js`.
  A fresh job bound to the app session is an available implementation path;
  borrowing an unrelated listed job worktree would bypass that ownership.
- `server/modules/websocket/services/chat-websocket.service.ts` deliberately
  overwrites client `cwd`/`projectPath` with `storedSession.project_path`.
  Project permission policy comes from that same stored project. This stops
  a browser from choosing a different execution directory through chat options.
- `server/gjc-bun-sdk-adapter.ts` creates/opens a `SessionManager`, builds
  cwd-specific settings, and calls `createAgentSession({ cwd, ... })` inside
  the supervised worker. It owns events, questions, permissions, steering,
  model selection, abort, and disposal. It has no broker-session attachment
  path. The existing worker contract explicitly excludes a side-channel
  fallback; see [`GJC-LIVE-SPEC.md`](../../server/GJC-LIVE-SPEC.md).
- `server/modules/database/repositories/sessions.db.ts` currently has a single
  `project_path`, without a separate execution cwd or worktree ownership
  binding. Transcript sync updates this field from the transcript's cwd.
  `projects.db.ts` hides `.gjc-worktrees` projects and project management rejects
  registering them. An arbitrary cwd substitution would also alter project
  grouping and permission lookup on restoration.

SDK launch worktrees use a configurable bucket (default `<repo>/.worktrees`),
which is distinct from native job `.gjc-worktrees`. Neither namespace can be
treated as proof that a directory is available to this app session.

The architecture roadmap already records native Slice 3 as completed; see
[`GJC-DESKTOP-ARCHITECTURE-ROADMAP.md`](../GJC-DESKTOP-ARCHITECTURE-ROADMAP.md).
The old blanket deferral in the handoff/live-spec must not be interpreted as
proof that the native multi-turn APIs are missing.

## Native continuation gap: fixed by `8a22e10`

An isolated Node probe used two temporary Git repositories, the real native
Git/job clients, and an injected supervisor that records dispatches without
starting a provider or model:

1. Start a job bound to `app-session-probe`, record `provider-session-probe`,
   and complete the first turn. Native state becomes `ready`.
2. Rename the owned worktree to a backup inside the fixture directory and
   replace its old path with a symlink to the second repository.
3. Call `turnStart('gjc', 'app-session-probe', ...)`.
4. The injected supervisor receives a second dispatch, retaining the provider
   session ID, whose cwd resolves to the foreign repository. No actual model
   was run; the observed failure is at the job-to-worker dispatch boundary.

`turnStart` trusts the path returned by `git.list()` and does not perform the
`git.status({ jobId, branch, path })` validation used by `resume`. Native list
items are discovery data, not a renewed path-ownership authorization. A
parent-owned fix should require the persisted branch and call the native
registered-worktree validation before dispatch on every continuation. Add
regressions for a removed path, a foreign-directory symlink, a replaced `.git`
pointer and an unchanged valid worktree. Revalidation narrows this gap; it
does not by itself guarantee protection against a path swap after validation.

There is a separate control integration concern: `start`/`turnStart` return
their handle only after `run.started`, whereas `spawnGjcRun` supplies an abort
handle synchronously. Chat must retain early-stop behavior while worktree
preparation/admission is pending, and stop through the job authority so a
cancelled run does not become a successful native job. Switching only the
spawn function does not establish those guarantees.

## Integration needed before a managed picker

The smallest existing execution foundation is a new native job bound to the
app session, with all subsequent turns going through that binding. Repair the
continuation validation above and integrate job admission/cancellation,
notifications and durable terminal states with chat before using it for the
picker. No SDK release is required to make those native APIs exist.

If the product instead adopts SDK-managed launch worktrees, attach/control
the public lifecycle session through the worker, or obtain an upstream
prepare/acquire contract designed for in-process `createAgentSession`. Do not
have the app both launch a lifecycle host and create its own session for the
same transcript. This follow-up does not edit the shared orchestrator or SDK
adapter, and does not propose private broker imports.

Acceptance for the existing run-location item should cover:

1. Keep project/repository identity separate from canonical actual execution
   cwd and provider session identity. Persist their binding before a run can
   dispatch; transcript indexing, refresh, and server restart must retain it.
2. Resolve the owning registered project on the server. Validate real paths,
   Git common-directory membership and registered worktree identity; reject
   foreign repositories, path traversal, symlink/pointer substitution, stale
   registrations, and native job-owned or otherwise occupied worktrees.
   Revalidate before every run/resume; a browser-supplied path is not authority.
3. Obtain runtime ownership before execution. Scope stable create/retry keys
   to the authenticated actor and app session, and reject mismatched provider
   identities on resume. The facade's actor/capability shape validation is
   not a substitute for application authentication or repository authorization.
4. Preserve permissions, prompt privacy, event ordering, controlled questions,
   steering, abort, and shutdown cleanup through the existing worker contract.
   A timeout/uncertain result must not launch another owner or fall back to the
   source checkout. Missing actual cwd is not a successful location selection.
5. Propagate actual cwd to every directory-sensitive session operation,
   including execution/settings, attachments and file references, exports,
   workspace context and change review. Continue using the owning project's
   identity for project grouping and its permission policy.
6. Offer a compact run-location choice before a new session starts, using
   the existing UI primitives and semantic tokens in `DESIGN.md`. Show the
   persisted location on resume. No automatic worktree deletion, pruning,
   checkout/reset, commit, or merge. Surface conflicts without changing Git.
7. Prove creation, multiple turns, resume/restart, concurrent ownership,
   tampered/stale paths, cancellation and uncertain outcomes in disposable
   repositories. Add keyboard/mobile browser coverage after the runtime path
   works. A mock lifecycle call is not end-to-end evidence.

A read-only picker among existing manually created worktrees is technically
possible using the public cwd option. It still requires the identity,
authorization, occupancy, persistence and directory-sensitive propagation
above. It would be a separately narrowed product scope, not completion of
the planned runtime-managed isolation feature. No such partial picker is
introduced here.

## Conversation forks and split panes

The Local Studio adoption plan explicitly defers forking from a message until
usage demonstrates value for conversation-only branching. It says that a fork
does not restore files or create a Git branch/worktree. Availability of the
SDK lifecycle `session.fork` API does not resolve that product decision or
define which message/turn to branch from. Do not add a session-menu fork action
as an SDK-upgrade acceptance item.

Split-pane multi-session workspaces are listed under "Later evaluation";
side chat is conditional on that evaluation. There is no accepted pane layout,
navigation/persistence model, or mobile interaction specification. Neither
split panes nor side chat is an unimplemented acceptance criterion from shipped
phases 1–5. Their evaluation remains separate from the managed worktree picker.

## Reproducible contract checks

`server/gjc-session-worktree-contract.bun.test.ts` imports the public lifecycle
service and injects its transport. It checks worktree request/actual-cwd
round trips, deferred dispatch, actor-scoped idempotency, rejected authority,
occupancy/uncertain failures, and resume identity. It never constructs the
default broker client, starts a host, calls a model, or modifies a repository.

Run against the parent's SDK 0.16.4 dependency update with Bun exactly 1.4.0:

```sh
dist-native/bun test server/gjc-session-worktree-contract.bun.test.ts
```

These lifecycle tests establish SDK compatibility. The application uses its
existing native job authority and supervised worker instead of launching a
second SDK broker host.

## Implemented application path

- `session_worktrees` stores a unique app-session/job/repository binding and
  the prepared execution cwd. The session's `project_path` remains the canonical
  owning project, including after transcript indexing and database reopen.
  The allocation transaction creates both rows before chat can dispatch.
- `POST /api/providers/worktree-sessions` requires a registered, active Git
  repository root with a commit. It accepts a project identity, not a checkout
  supplied by the browser. The checkout is allocated on the first turn.
  `/api/providers/sessions/:sessionId/location` reports the persisted location.
- `session-worktree-runtime.ts` sends the first turn through native `start`,
  subsequent turns through `turnStart`, and interrupted runs through `resume`.
  Every run validates the canonical repository and registered Git worktree.
  The parent project supplies permission policy; client cwd and policy options
  cannot override it. The actual worker handle remains available for steering.
- An abort ticket exists before asynchronous model lookup or preparation.
  Confirmed startup cancellation retains a reusable checkout, and chat complete
  is withheld until native authority finishes the turn. A Stop request is not
  proof of termination: unconfirmed termination keeps native ownership and
  blocks another run. Failed terminal messages cannot become native success.
- Session-scoped file reads, file mentions, command/skill discovery, external
  file resolution, Git status and diffs use the execution cwd. History and
  transcript exports retain project identity and separately report the cwd.
  Location changes invalidate the related client requests.
- Existing sessions retain their selected location. Archive, restoration,
  failure, cancellation and shutdown do not delete, prune, reset, commit or
  merge a worktree. Missing or conflicting authority fails closed; it never
  changes to the source checkout or borrows another session's worktree.

`server/services/session-worktree-runtime.test.ts` uses disposable committed
Git repositories, real native Git/job clients, SQLite, REST routes and the
chat WebSocket handler. Only provider execution is injected; no model runs.
It covers multiple turns, a fresh native client after interrupted admission,
canonical aliases, separate concurrent sessions, duplicate claims, transcript
sync/export, Git context, archive/restore, tampered paths, startup failure,
early cancellation and unconfirmed outcomes. The picker/composer DOM suite
covers allocation, failure without a source-project fallback, file resolution,
and Git context changes.

```sh
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test \
  server/services/session-worktree-runtime.test.ts \
  server/services/gjc-job-orchestrator.worktree.test.ts \
  server/modules/providers/tests/session-project-binding.test.ts
dist-native/bun test src/components/chat/view/SessionWorktreePicker.dom.bun.test.tsx
```

Run each Bun file separately so the DOM preload cannot leak into server SDK
contract tests. Parent integration owns the live provider/browser E2E and the
overlapping goal/abort/replay changes in the orchestrator, chat WebSocket and
ChatInterface. This worktree does not claim those live checks have passed.
Filesystem revalidation narrows substitution attacks but cannot prevent a
concurrent filesystem change after validation. A lost binding or a failed
reservation that cannot prove safe recovery remains an explicit conflict;
there is no automatic Git repair or cleanup.

## Validation on the assigned integration worktree

Node 22.23.1, Bun 1.4.0, and installed SDK 0.16.4 were used. No live model was
called. Typecheck, ESLint, identity, audit, license checks, native fmt/clippy
and all 61 native tests passed. All 90 server Node test files passed, as did
469 client Node tests, 201 DOM tests across 33 files, the remaining server Bun
contracts, and 23 script tests. Vite's production client build passed.

The complete `verify` gate is **not green on this base**: dependency notices
do not match the private dependency tree, and the full build stops at the
darwin-arm64 runtime-manifest check. The existing SDK contract suite also has
three failing assertions: builtin exclusion coverage, the default-model
profile without a thinking suffix, and production-worker manifest initialize.
The base package still pins SDK 0.15.6; dependency, notice and manifest updates
belong to parent integration and are not changed or bypassed here. These checks
must pass against the parent's combined tree before promotion.

Cherry-pick `8a22e10` first if it is not already integrated. Preserve the
parent's independent `goal` locale namespace alongside this change's
`sessionWorktree` namespace. The shared integration points are
`gjc-job-orchestrator.ts`, `chat-websocket.service.ts`, `ChatInterface.tsx`, and
server startup composition; the worktree runtime's cancellation hooks and
parent goal/disposal hooks must both survive conflict resolution.
