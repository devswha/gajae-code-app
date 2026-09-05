# Managed session worktrees: goal scope and indexing acceptance

This supplements `748e07a`. Parent integration owns `handleChatGoal` and its
helper; this follow-up does not edit them or claim browser/live-model coverage.

## Existing public application APIs

`server/services/session-worktree-paths.ts` exports:

```ts
resolveSessionWorkspacePath(projectId: string, sessionId?: unknown): Promise<string>
readSessionLocation(sessionId: string): {
  mode: 'project' | 'worktree';
  projectPath: string;
  cwd: string | null;
  jobId: string | null;
}
```

Use `await resolveSessionWorkspacePath(project.project_id, appSessionId)` for
directory-sensitive idle goal get/inspect. Resolve `project` from
`projectsDb.getProjectPath(storedSession.project_path)`. Keep
`projectPath: storedSession.project_path` and `cwd: resolvedCwd` as separate
fields in the worker scope. Use the **app session ID**, not the provider ID,
for this lookup. The resolver validates session/project membership, canonical
repository and checkout paths, and the native registered Git worktree pointer.
It neither reserves a job nor starts a worker. A prepared worktree that has
become unavailable throws; it never falls back to the source project.

`readSessionLocation` is metadata only. A `null` worktree cwd means the checkout
has not been prepared; it is not permission to substitute the project root.
`sessionTranscriptWorkspace` is intentionally a metadata helper for offline
history/export, and is not a filesystem authorization check for goal access.

For native session ownership, the public orchestrator method is:

```ts
orchestrator.resolveBinding('gjc', appSessionId): Promise<{
  jobId: string;
  state: string;
  providerSessionId?: string | null;
} | null>
```

It calls the native authority's public `bindingResolve({ provider, appSessionId })`.
It has no cwd field. For a worktree goal scope, compare its `jobId` with
`sessionWorktreesDb.get(appSessionId).job_id` and its provider identity with the
stored provider session ID, in addition to resolving the validated cwd above.
Missing/mismatched native ownership must be an explicit conflict, never a
new job or a root-project lookup. Use the existing production orchestrator;
do not create a second execution owner. Recheck scope after asynchronous
lookups before acting if the app-session binding changed in the meantime.

Inject this resolver at server startup across the WebSocket module boundary,
as the existing worktree runtime is injected. Avoid importing a provider
service's internal implementation into the WebSocket module. The current
provider-internal `resolveSessionCommandWorkspace(projectId, sessionId)` is a
wrapper around the same configured resolver, not a separate SDK operation.

For a session with no provider identity and no prepared checkout, idle get can
report no goal without opening the SDK; an operation requiring an existing
workspace must report unprepared scope. Neither case should allocate a native
job as a side effect of inspecting the UI.

## Active pause/drop and run identity

The client's expected run ID remains `writer.getAbortHandle()` (the worktree
ticket). For the server's SDK control request, map that ticket with
`sessionWorktrees.workerHandle(ticket)`. An undefined result means no worker
has been attached yet; the ticket itself is not an SDK worker handle.

Parent integration should mutate goal state with a server-only deferred-abort
option, then call `sessionWorktrees.abort(capturedTicket)`. This API handles
model lookup and preparation as well as a running worker. Calling the native
orchestrator's ordinary `abort` instead does not cover early startup: admission
holds its per-job serial operation until `run.started` settles.

Require an explicit confirmed result. `false` means the stop was not confirmed;
`null` means the ticket is unavailable or stale. Neither authorizes a raw SDK
abort fallback. Do not replace the captured ticket with a newer run during
retry. If goal state changed but execution could not stop, report both facts.

There is a caveat in `748e07a`: the worktree abort wrapper currently catches a
rejected `ticket.finished` before inspecting the worker outcome, so `true`
alone does not establish that native finalization persisted successfully.
Parent pause/drop integration must preserve that failure rather than equating
worker termination with a successful durable terminal result. This indexing
follow-up does not modify the abort wrapper or the parent's goal files.

Add parent tests that record SDK goal mutation, raw SDK abort calls, native
terminal events and the client ticket separately: deferred mutation must not
abort directly; ticket cancellation must produce the native aborted outcome;
uncertain disposal/finalization must not emit success; a late result must not
terminate a new run admitted under a different ticket.

## Parent end-to-end acceptance matrix

Use disposable committed repositories and Astra/xhigh for any live model run.
Keep the parent checkout visibly different from the managed checkout so a
mistaken cwd is detectable.

| Scenario | Required observations |
| --- | --- |
| New-worktree selection, before first send | No job/worker starts from goal get/inspect. A pending cwd is not replaced with the project root. |
| First run and idle goal get | `projectPath` remains the owning project; worker/goal scope `cwd` is the managed checkout. Source checkout content is unchanged. |
| Goal create/update/pause/resume | Operations address the same provider session and goal state. Parent project permission policy remains authoritative; client cwd/projectPath/policy overrides have no effect. |
| Ready session after server restart | Idle inspect performs no run admission. Reopened native binding, provider ID, actual cwd and goal state match the previous session. |
| Interrupted admission after restart | Inspect does not mark a run successful or dispatch it; explicit continuation follows the existing resume authority. |
| Two sessions in one project | Different worktree/job/provider bindings and goal states remain isolated across navigation and refresh. |
| Missing or substituted checkout, foreign Git pointer, released/mismatched binding | Reject scope before invoking SDK goal access. Keep Git files and native ownership intact. |
| Stop during preparation or model lookup | No late dispatch, no successful goal completion, no automatic worktree deletion. |
| Refused/uncertain abort or failed disposal | No fabricated successful terminal state; preserve ownership until the parent's runtime authority confirms termination. |
| SDK transcript update, full rescan and reload | One owning app session remains under the parent project; transcript header cwd remains the actual checkout; history and exports stay readable. |
| Locale merge and mobile/keyboard UI | Preserve both `goal` and `sessionWorktree` namespaces. Existing session location is fixed and the goal controls address the viewed session. |

## Real SDK transcript indexing verification

`server/services/session-worktree-indexing.test.ts` runs SDK 0.16.4
`SessionManager.create/open`, `appendMessage`, `ensureOnDisk`, and
`flushAndCloseStrict` in a child Bun 1.4.0 process. It uses explicit temporary
session destinations and strips inherited terminal identity. No AgentSession,
broker, model, or credential is constructed. The real app synchronizer,
SQLite database, history reader, and native Git path validation run in Node.

Five regressions cover:

1. Provider-mapped transcripts through `synchronizeFile`, `reconcile`, SDK
   reopen/append, database reopen and `synchronize`; the parent project and
   its permission policy remain stable while the header retains actual cwd.
2. Transcript discovery before provider announcement, followed by the normal
   merge into the owning app session and another full scan.
3. A real SDK provider ID deliberately reused as a pending bound app ID. This
   reproduced a bug: the direct `ON CONFLICT(session_id)` upsert overwrote the
   parent project with worktree cwd. Both upsert branches now preserve the
   binding's repository root.
4. A colliding transcript ID cannot overwrite an already different provider
   identity belonging to a bound session.
5. Duplicate provider announcement cannot merge away a different bound session
   and cascade-delete its worktree binding. Ordinary unbound watcher rows can
   still merge as before.

The five new cases and relevant database mapping, synchronizer, export and
runtime suites passed: **58 tests**, with typecheck and ESLint also passing.
This verifies the actual SDK transcript format and actual indexing code; it
does not claim OS watcher-event, goal-worker or browser E2E execution. Full
promotion checks still belong to the parent's combined dependency tree.
