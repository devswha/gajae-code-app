# Agent Sidebar Activity Capability Audit

Status: research/design only — no production code changed (2026-09-11).
Scope: what structured agent/runtime activity exists **today**, end to end, and
what the smallest additional contract would be for a future `AgentSidebar`
(Needs attention / Current work / Tasks / Agents / Review / Browser activity).

Everything below is traced to source. Where a capability does not exist, that
is stated with the evidence checked. Nothing here redesigns the todo system,
the delegation executor, the worker protocol, or the browser architecture.

Sources inspected:

- App: `server/gjc-worker-protocol.ts`, `server/gjc-bun-sdk-adapter.ts`,
  `server/gjc-bun-sdk-events.ts`, `server/gjc-delegation-executor.ts`,
  `server/gjc-agent-tools.ts`, `server/gjc-worker-client.ts`,
  `server/modules/websocket/services/chat-run-registry.service.ts`,
  `chat-websocket.service.ts`, `server/services/gjc-job-orchestrator.ts`,
  `server/modules/providers/**` (session watcher/synchronizer),
  `src/stores/sessionStatusModel.ts`, `src/stores/useSessionAttentionStore.ts`,
  `src/components/chat/hooks/useSessionTodos.ts`,
  `src/components/app/useRunningSessionsSync.ts`,
  `src/components/agent-sidebar/*` (the sidebar shell that landed on `main`
  via #62; read-only here).
- GJC SDK `@gajae-code/coding-agent` 0.16.4 (full source in
  `node_modules/@gajae-code/coding-agent/src`): `session/agent-session.ts`
  (`AgentSessionEvent`), `@gajae-code/agent-core/src/types.ts` (`AgentEvent`),
  `task/*`, `tools/{todo-write,todo-contract,irc,subagent}.ts`,
  `async/job-manager.ts`, `registry/agent-registry.ts`, `modes/**` (TUI).

## Goal

The future AgentSidebar must render **authoritative runtime state**. This audit
determines, per candidate sidebar concept, whether the data:

- exists in the GJC runtime,
- crosses the worker protocol,
- reaches the server and browser,
- survives reload,
- and is authoritative, derivable, heuristic, or unavailable.

The classification used throughout:

| Class | Meaning |
| --- | --- |
| A | Already available and authoritative in the App |
| B | Available in GJC but not currently transported to the App |
| C | Can be derived safely from existing authoritative events |
| D | Would require a new GJC/runtime capability |
| E | Should not be exposed because the meaning is ambiguous |

## Current App Signals

### The transport chain

```text
GJC SDK (Bun worker process, in-process session.subscribe)
  └─ server/gjc-bun-sdk-events.ts   forwardSdkEvent()  — whitelist of SDK events
  └─ server/gjc-worker.ts           Protocol v1 NDJSON events (stdio)
       session.created · message.delta · message.completed · tool.started ·
       tool.completed · ask.presented · usage.updated · turn.completed ·
       turn.failed · worker.status
  └─ server/gjc-worker-client.ts    normalize → browser message kinds; mirrors
       approvals; exactly-one terminal event per run
  └─ server/modules/websocket/services/chat-websocket.service.ts
       chat_run frames (seq + replayGeneration), replay buffer, broadcast
  └─ client: useSessionStore (message windows), PermissionContext,
       useSessionAttentionStore, SessionStatusContext/useRunningSessionsSync
  └─ UI: chat, PermissionRequestsBanner, ChatTasksPanel, SessionStatusDot,
       sidebar rows, notification handlers
```

Durability: the server persists **no chat rows**. `ChatSessionWriter` is
broadcast-only; the durable transcript is the SDK session JSONL on disk, read
back through `GET /api/providers/sessions/:id/messages`. Live replay uses an
in-memory buffer (5 000 events; completed runs retained 5 min).

### Signal-by-signal

| Signal | Source | Transport | App state | Consumer | Lifetime / reload | Authority |
| --- | --- | --- | --- | --- | --- | --- |
| Run started/running | worker start/resume pending response; `worker.activity` counters | worker protocol; `chatRunRegistry` active-run map | `GET /api/providers/sessions/running` → `{statusText, canInterrupt, startedAt, awaitingInput}` (`RunningRunSummary`, chat-run-registry.service.ts:23) | `useRunningSessionsSync` (5 s poll), `chat_subscribed.isProcessing` | in-memory only; browser reload re-polls; **lost on server restart** | **A** (server-known run registry) |
| Run completed / failed / aborted | `turn.completed` / `turn.failed` (worker); SDK `prompt()` promise + final `message_end.stopReason` (`stop\|length\|toolUse\|error\|aborted`) | normalized `complete {exitCode, aborted, success}` + `error` frames | client `useSessionAttentionStore.recordOutcome` via `outcomeOfCompletion` (sessionStatusModel.ts:65) | SessionStatusDot, sidebar rows, notifications | outcome memory is **per-device localStorage** (`session-attention-v1`, 300 entries); run itself in-memory | **A** at source; per-device memory is a client cache |
| Waiting for approval | SDK permission provider → `GjcBunAskController.requestPermission` → `ask.presented` (`sdk-permission:<uuid>`, real `toolName`, `rawInput` as `input`) | worker `ask.presented` → browser `permission_request` frame | server mirror: `chatRunRegistry.pendingApprovals` (`{appSessionId, toolName}`); `awaitingInput = pendingApprovals.size > 0` | PermissionRequestsBanner, question panel; reply `chat.permission-response` → `ask.reply` | **survives reload** while the run lives: `chat_subscribed` carries `pendingPermissions` (chat-websocket.service.ts:275); cleared by `permission_cancelled`/complete/run end | **A** |
| Waiting for user answer | SDK `ask` tool via `setToolUIContext` UI bridge → `sdk-ask:<uuid>` (`toolName:'ask'`, `input.questions`) | same pipe as approvals | same mirror | question panel (`ask`\|`AskUserQuestion` interception), PlanDisplay for plan exits | same as approvals; an unanswered ask blocks the tool call — the pending state itself is host-side, not an SDK event | **A** |
| Tool execution / completion | SDK `tool_execution_start/update/end` | `tool_use {toolId, toolName, toolInput}` / `tool_result {isFinal, toolUseResult, isError}` frames; structured `details` survive as `toolUseResult` | message windows in `useSessionStore` | tool cards (`toolConfigs.ts` keyed by runtime tool name) | reload: re-fetched from REST transcript (tool results persisted in SDK JSONL) | **A** |
| Session todos | `todo_write` tool result `details.phases` | rides `tool_result.toolUseResult` | client fold: `sessionTodos()` — latest structured result wins (useSessionTodos.ts:95) | ChatTasksPanel (per-phase checklist; first `in_progress` ?? first pending) | reload: reconstructed from REST transcript (results are persisted); **no server-side todo state** | **A** (data), fold is C |
| Session status ("one status per row") | `sessionStatusModel.deriveSessionStatus` over `{running, awaitingInput, outcome, lastViewedAt, isViewed}` (sessionStatusModel.ts:47) | REST poll + WS events | attention store (localStorage outcomes/lastViewedAt; in-memory pendingInput; 7 s reconcile against server `awaitingInput`) | SessionStatusDot/Glyph, work-list counts, sidebar rows | outcomes persist per device; running/needs_input re-derived from poll after reload | precedence `needs_input > running > ready/blocked > idle`; **A** inputs, C derivation |
| Activity line (composer) | `status` frames: `session_state` snapshot, `token_budget`, transient activity text (compaction/retry phases), `text:'ready'` | worker events → `status` frames | message stream (transient, not persisted) | composer/status indicator | in-memory only | status text **A**; `deriveLiveActivity` label from text is **H** (heuristic — do not use for sidebar semantics) |
| Session list | native `gajae-core watch` → `GjcSessionSynchronizer` (SQLite upsert) → `session_upserted` | WS broadcast to all clients | react-query projects/sessions cache | sidebar session rows | durable (DB) + WS deltas | **A** but the frame carries **no status field** and `messageCount` is hardcoded `0` (sessions-watcher.service.ts:122) — row state comes from the attention/running signals above |
| Browser activity | app-owned browser/computer tools + Workspace Browser; sidecar `state` events | WS `/ws/browser?sessionId[&mode=state]` (JSON `BrowserSessionState`; binary JPEG in full mode); REST `/api/automation/*` | `shared/browserSessionState.ts` `{sessionId, activeTabId, tabs[{id,title,url,loading,canGoBack,canGoForward}]}` | BrowserPanel (full), `useBrowserAutoReveal` (state-only) | state re-read from sidecar cache after reload; screencast needs live subscription | **A** |
| Managed jobs | native job authority (`gajae-core jobs`), `JobState` reserved/queued/running/aborting/ready/succeeded/failed/aborted/interrupted; orchestrator `server/services/gjc-job-orchestrator.ts` | REST `/api/gjc/jobs*` + WS `gjc.job.subscribe/replay` (job projection, `shared/gjc-job-projection-protocol.ts`) | client projection slot exists in `useSessionStore`; **no component subscribes** | none — jobs UI was removed; projection plumbing is dormant | durable (Rust-owned SQLite + ordered replay) | **A** at source, unused. Note: job `ready` means *workspace awaiting next turn* ("Only ready jobs can start a new turn", gjc-job-orchestrator.ts:427) — it is **not** an attention signal |
| Worker activity counts | `worker.activity` → `GjcWorkerActivity {generation, complete, starting, queued, running, settling, approvals, retained, unknown}` | worker protocol (host pull) | desktop restart authority only (server/index.js) | none user-visible | per generation | **A** but restart-gating evidence, not a UI signal |
| Notifications | `notifyRunStopped`/`notifyRunFailed` (`run.stopped`/`run.failed`) | orchestrator service; in-app/desktop/sound, prefs-gated, 20 s dedupe | desktop-notifications WS | toast/title/sound | durable dispatch only for job terminals (ledger + startup catch-up) | **A** trigger sources |
| AgentSidebar shell | `src/components/agent-sidebar/agentSidebarState.ts` (on `main` since #62) | none | localStorage `agent-sidebar` = `{open, width}` only | MainContentRightRail | persists | presentation-only; **consumes zero agent signals today** |

## Current GJC Runtime Signals

### SDK event surface (what the App's worker subscribes to)

`AgentSession.subscribe` delivers `AgentSessionEvent`
(`coding-agent/src/session/agent-session.ts:788`) = core `AgentEvent`
(`@gajae-code/agent-core/src/types.ts:804`) plus session extensions:

- Core: `agent_start`, `agent_failed {error}`, `agent_end {messages, stopReason:
  completed|paused|cancelled|maintenance, maintenanceOutcome?, disownedSteering?}`,
  `turn_start`, `turn_end`, `message_start`, `message_update`
  (assistant deltas), `message_end`, `tool_execution_start/update/end`.
- Session-added: `auto_compaction_start/end`, `auto_retry_start/end`,
  `model_fallback_switched`, `ttsr_triggered`, **`todo_reminder {todos, attempt,
  maxAttempts}`**, **`todo_auto_clear`**, **`irc_message {message}`**,
  **`subagent_steer_message {message}`**, `notice`, `thinking_level_changed`,
  `goal_updated`.

The App forwards a **strict subset**: `gjc-bun-sdk-events.ts`
`SDK_EVENT_FIELDS_READ` whitelists `tool_execution_*`, `auto_compaction_*`,
`auto_retry_*`, `model_fallback_switched`, `notice`, `goal_updated`, plus
message/thinking deltas. A contract test (`gjc-bun-sdk-events.contract.test.ts`)
keeps the whitelist aligned with SDK declarations. **Not forwarded today**:
`agent_start/agent_end/agent_failed`, `turn_start/turn_end`, `message_start`,
`irc_message`, `subagent_steer_message`, `todo_reminder`, `todo_auto_clear`,
`ttsr_triggered`, `thinking_level_changed`. Terminal ownership deliberately
stays with the `prompt()` promise (`forwardPromptTerminal`).

Run semantics: a run = one `session.prompt()`; `session.isStreaming`; steer
queues into the running turn, follow-up queues behind it; `session.abort()`
cancels. The out-of-process SDK host (`src/sdk/host/*`, `EventFrame`
generation/seq replay, `TurnResult` receipts) exists but **the App does not use
that layer** — it embeds the SDK in-process in the Bun worker.

### Subagents: two distinct systems

**(1) SDK-native task system** (`src/task/*`, used by the CLI, **not used by
the App**):

- Real identity: allocated ids `^\d+-<name>(\.\d+-<name>)*$` (`task/id.ts`),
  process-wide `AgentRegistry` refs `{id, displayName, kind: main|sub,
  parentId, status, sessionFile}`; main agent is `0-Main`.
- Roles: `AgentDefinition {name, description, systemPrompt, tools?, spawns?,
  model?, thinkingLevel?, source}` (bundled/user/project).
- Status: `AgentProgress.status = pending|running|completed|failed|aborted|paused`
  with `currentTool`, tokens/cost, nested `inflightTaskDetails`;
  `SubagentLifecyclePayload.status = started|completed|failed|aborted|paused`.
- Parent-stream visibility: (a) `task` tool events carrying
  `TaskToolDetails {results, progress?: AgentProgress[], async?, usage?}` on
  `tool_execution_update`; (b) a **separate EventBus**
  (`task:subagent:event|progress|lifecycle`) returned by `createAgentSession`
  — the TUI's live subagent count and observer overlay are built on it
  (`modes/session-observer-registry.ts`, status-line segments). Both channels
  are available to an SDK host; the TUI aggregation component itself is not
  exported.
- Parallelism/background: `mapWithConcurrencyLimit` under `task.maxConcurrency`;
  background execution via `AsyncJobManager` (`AsyncJob {id, generation, type:
  bash|task, status, label, resultText?, metadata {foldReason, subagent?},
  ownerId}`), `job` tool (poll/cancel/list/tail), `subagent` control tool
  (`list|inspect|await|cancel|pause|resume|steer`), isolated worktree
  execution. Jobs are **process-lifetime** — nothing survives process exit.
- Each child writes its own JSONL in the parent session's artifacts dir with a
  `session_init` entry; there is **no `isSubagent` flag** in the session header
  (identification is structural: directory + `session_init` + runtime registry).

**(2) App-owned delegation** (`server/gjc-delegation-executor.ts` — **what
actually runs in the App**). The adapter strips the SDK's `task`/`subagent`
builtins from `toolNames` (gjc-bun-sdk-adapter.ts:1003-1015) and installs
`GjcDelegationExecutor` custom tools instead. Consequences:

- The SDK task executor never runs in App sessions, so the SDK's subagent
  EventBus events (`task:subagent:*`) never fire here.
- Children are created directly via `createAgentSession` with the parent's
  model/effort/credential/tool policy; `goal`/`memory`/`compaction`/discovery
  disabled; tool allowlist narrowed by role; no IRC/yield for children
  (explicit in the child system prompt).
- Hard limits (`GJC_DELEGATION_LIMITS`): 4 concurrent, depth 2, 32 launches per
  turn, 5 min per child; children are cancelled when the owner turn ends;
  no detached work beyond the turn; no model overrides.
- Identity is the **receipt**, persisted as custom entries
  (`customType: 'gajae-app.delegation.v1'`) in the *owner's* SDK transcript at
  launch and again at settle:

  ```ts
  Receipt = {
    id: uuid;                 // delegation id (also passed as agentId)
    owner: uuid;              // direct parent session id
    root: uuid;               // root app session id
    childSessionId: uuid;     // the child's own GJC session
    file: string;             // child transcript basename
    agent: string;            // bundled role (regex ^[a-z][a-z0-9-]{0,63}$)
    executionMode?: 'default' | 'ultragoal-red-team';
    repositoryBinding?: ...;
    description: string;      // ui label
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    resultText: string;       // ≤16 000 chars of the child's final answer
  }
  ```

- Child transcripts live under
  `<parentSessionDir>/.app-delegation/<root>/<owner>/<file>.jsonl` (path-
  contained, identity-checked on resume). The session synchronizer's depth
  filter (`isSubagentTranscript`, >2 path segments) excludes them from the
  session list.
- Resume semantics: receipts are re-read from the owner transcript; a `running`
  receipt with no live job is normalized to `cancelled` — "a process restart or
  owner-turn disposal never resurrects background work."
- **What the browser sees**: only the `task`/`subagent` **tool call boundaries**
  — `tool_use` (input = the model's request) and `tool_result` whose
  `toolUseResult` is `{subagents: [snapshot, ...]}`. The snapshot strips
  `file/owner/root/childSessionId` (public shape: `id, agent, description,
  executionMode, repositoryBinding, status, resultText`). There are **no live
  lifecycle events**: a child that completes while the parent is streaming text
  updates its receipt in the transcript, but nothing notifies the worker
  protocol until the model happens to call `task`/`subagent` again.
- The delegation authorize gate rides the existing permission pipe
  (`GjcBunAskController.requestPermission`, "Run delegated work using the
  selected model and credentials?") → the same `sdk-permission:` frames.

### Agent-to-agent communication

The SDK has a **real structured channel**: the `irc` tool
(`op: send|list`, `to: <agentId>|all`, `awaitReply`) routed through the
process-global `AgentRegistry`; replies via an ephemeral background turn and
injection into the recipient's history; observability through the
`irc_message` / `subagent_steer_message` session events carrying
`CustomMessage` records (`customType: 'irc:relay'`, `'subagent:steer'`) with
structured `details {from, to, body, state, kind}`. This is structured
inter-agent messaging, not transcript text.

In the App: the `irc` tool is **withheld by policy**
(`GJC_AGENT_TOOLS_WITHHELD['irc'] = 'Network chat unrelated to coding in this
app.'`, gjc-agent-tools.ts), the events are not forwarded, and delegated
children explicitly have no IRC. The only parent↔child exchange that exists in
the App is the delegation contract: an assignment message in, one bounded
`resultText` out (a result, not a message channel), plus `resume` with a new
message.

### Background work

SDK side: `AsyncJobManager` + `job`/`monitor`/`cron` tools. App side: all three
are withheld with recorded reasons ("no screen for it", "nowhere to surface",
"no UI to review or cancel"). The App's background concepts are: (a) the
run/chat registry (live runs), and (b) managed durable jobs (native job
authority; projection plumbing landed but no UI). Delegated children are
turn-bounded by design.

## CLI vs App Capability Gaps

| Capability | GJC has it internally | SDK surface | App worker receives | Server forwards | Client receives |
| --- | --- | --- | --- | --- | --- |
| Run terminal (complete/fail/abort) | yes (`prompt()` + `agent_end.stopReason`) | yes | yes (`turn.completed/failed`) | yes (`complete`/`error`) | yes |
| Waiting-for-user (ask/permission) | yes (callbacks, no event) | via host-supplied UI bridge | yes (`ask.presented`) | yes (`permission_request` + `awaitingInput`) | yes |
| Tool lifecycle | yes | yes | yes | yes | yes |
| Todos | yes (tool result `details.phases`) | yes | yes (inside `tool_result`) | yes (`toolUseResult`) | yes (client fold) |
| Todo change event | reminder-only (`todo_reminder/todo_auto_clear`) | yes | no | no | no |
| Live subagent lifecycle | yes (SDK task system: EventBus + `TaskToolDetails.progress`) | yes (EventBus is returned to embedders) | **no — App replaces the task executor; its own executor emits nothing per transition** | no | only `task`/`subagent` tool results at call boundaries |
| Subagent identity/role | yes (allocated ids / registry; App: receipts) | yes | partially (receipt snapshot in tool result; hierarchy fields stripped) | partially | partially, stale between calls |
| Child progress streaming | yes (SDK `progress` tree) | yes (for SDK-executed tasks) | no (App children: only final `resultText`) | no | no |
| Agent-to-agent messages | yes (`irc` tool + `irc_message`/`subagent_steer_message` events) | yes | no (tool withheld; events unforwarded) | no | no |
| Background jobs | yes (`AsyncJobManager`) | yes | n/a (`job` tool withheld) | n/a | n/a (managed-job projection dormant) |
| Managed multi-turn jobs (App concept) | n/a (App-side) | n/a | yes (job authority/orchestrator) | yes (REST + projection WS) | plumbing only, **no UI** |

The important asymmetry: **the CLI's live subagent indicators come from the SDK
task system the App deliberately does not run.** Anything the future sidebar
wants about App subagents must come from `GjcDelegationExecutor` (receipts), or
require a new event from it. Nothing should be inferred from the SDK's task
tool semantics.

## Capability Matrix

Terminology note: in the App, "subagent" = an app-delegated child tracked by a
delegation receipt; "job" = a managed durable job (native job authority).

| Capability | Exists in GJC | Reaches App today | Authoritative source | Gap |
| --- | --- | --- | --- | --- |
| session running | yes — `prompt()` in flight; `isStreaming`; worker activity counters | yes — `chatRunRegistry` → `GET /api/providers/sessions/running`, `chat_subscribed.isProcessing` | server run registry (in-memory) | none for UI; lost on server restart (runs die anyway) |
| session completed | yes — `turn.completed`; `complete {success:true}` | yes | worker terminal event + run registry | outcome memory is per-device; acceptable |
| session failed | yes — `turn.failed`; `error` + `complete {success:false}` | yes | same | same |
| waiting for approval | yes — permission provider callback | yes — `sdk-permission:` frames; `pendingApprovals` mirror; `awaitingInput` | server approval mirror | none |
| waiting for user answer | yes — `ask` UI bridge | yes — `sdk-ask:` frames; same mirror | same | none |
| current tool/activity | yes — `tool_execution_*`; status events | yes — `tool_use`/`tool_result` frames; status frames | SDK tool events via worker | "current activity" between tools is only streaming text + transient status text; no structured activity concept — treat label derivation as heuristic |
| todo list | yes — `todo_write` result `details.phases` | yes — `toolUseResult` on `tool_result`; client fold reconstructs on reload | SDK transcript (durable) | no change event (fold re-derives on message changes — sufficient) |
| current todo | yes — exactly-one `in_progress` invariant (`normalizeInProgressTask`) | derivable (C) | todo phases | none |
| subagent spawned | yes (App: delegation receipts) | at tool-call boundaries only — `task` tool result `{subagents:[...]}` | receipt (owner transcript, durable) | **no live event** at launch (tool result is close to launch — returned immediately) — launch is effectively visible |
| subagent identity | yes — receipt `{id, owner, root, childSessionId}` | partially — public snapshot strips `owner/root/childSessionId` | receipts in owner transcript | hierarchy not on the wire; recoverable only by folding tool results |
| subagent role | yes — `agent` (bundled role), `description` | yes (in snapshot) | receipt | none |
| subagent status | yes — `running/completed/failed/cancelled` | **stale** — only refreshed when the model calls `task`/`subagent` again, or on replay | receipt + live job map (worker memory) | **no lifecycle events; no browser correlation id (`runId` not exposed)** |
| subagent completed | yes — receipt settled + `resultText` (≤16 KB) | at next tool boundary / reload fold | receipt | no event at settle time |
| agent-to-agent message | yes — `irc` tool + `irc_message`/`subagent_steer_message` (structured) | no — tool withheld by policy; events not forwarded | n/a in App | policy decision, not just transport |
| background work | yes — SDK `AsyncJobManager` (process-lifetime); App managed jobs (durable) | SDK background tools withheld; managed jobs: projection exists, **no UI** | native job authority | no runtime gap; a product/UI gap only |

## TODO / Task State

- **Authoritative representation**: `TodoWriteToolDetails.phases` —
  `TodoPhase {name, tasks: TodoItem[]}`; `TodoItem {content, status:
  pending|in_progress|completed|abandoned, notes?[]}`. Ops: `init | start |
  done | drop | rm | append | note`. Tasks are addressed by verbatim content,
  never by id.
- **Persistence**: no separate state file. Phases live in the session
  transcript as the successful `todo_write` tool result's `details`
  (`storage: 'session' | 'memory'`), plus `user_todo_edit` custom entries for
  CLI-side user edits; recovery scans for the latest of either
  (`getLatestTodoPhasesFromEntries`). A session-level cache
  (`session.setTodoPhases`) is runtime-only.
- **Current-task state**: explicit in the data and maintained by the tool —
  `normalizeInProgressTask` enforces exactly one `in_progress` and
  auto-promotes the first `pending` after each completion. So "current task" is
  class C (safe derivation from authoritative phases), not a guess.
- **App reconstruction**: yes. `sessionTodos()` (useSessionTodos.ts) folds the
  **latest structured result** across the message window (ops-folding is only a
  fallback for old transcripts without results). On reload the window is
  re-fetched from the REST transcript, so the todo list is reconstructed
  without server state. `ChatTasksPanel` renders it; the `todo_write` tool card
  itself renders the *input ops* (display only).
- **Verdict**: a read-only Tasks sidebar section needs **no runtime change**.
  A `todo` change *event* would only matter if the sidebar needed updates
  decoupled from the message window — it already re-derives whenever messages
  change, so it does not. Do not add one.

## Needs Attention

In this document, **Needs attention means exactly one thing: the agent is
waiting for the user** — a run that cannot proceed until the user answers.
Everything else that merely happened (completed runs, failures, unread
results, ready changes) is **Review / recent activity**, not attention, no
matter how much the user may want to look at it.

**Needs attention — the run is blocked on the user:**

- Unanswered tool approval / permission — `sdk-permission:` request,
  mirror-backed `awaitingInput`, reload-safe. **A**.
- Unanswered question — `sdk-ask:` request, same pipe/mirror. **A**.
- Delegation authorization — rides the same permission pipe ("Run delegated
  work…?"). **A**.
- These are exactly `sessionStatusModel`'s `needs_input`, which already
  outranks everything including the open session. (The repo's existing
  `needsAttention()` helper in `sessionStatusModel.ts` additionally folds
  unread `ready`/`blocked` outcomes into its set for row ordering; this
  document deliberately does not call those Needs attention — they are
  Review. No rename is proposed here.)

There is no other runtime-blocked-on-user state: an unanswered ask *is* the
block, and it is observable through the server mirror (the SDK exposes no
"waiting for user" event; the host-side bridge is what makes it visible — the
App already surfaces it).

**Not Needs attention — Review / recent activity** (nothing is blocked; the
user may want to look):

- Run finished while not looking (`ready` outcome) / run failed (`blocked`
  outcome) — from the authoritative `complete` frame; unread until viewed.
  **A** trigger, client-side memory.
- Failed delegated child / subagent result ready — receipt `status: failed` /
  `resultText`, but only discoverable at tool boundaries (see gaps). **A/B**.
- Notifications (`run.failed`, `run.stopped`) — already prefs-gated. **A**.

**Must not be surfaced as Needs attention (or Review) at all:**

- Managed job state `ready` ("workspace awaiting next turn") — a lifecycle
  state of the durable job machine, not a user-action request.
- Long-running tools, "no events for N seconds", spinner text, or any
  derivation of `deriveLiveActivity` — heuristic (class E for sidebar
  semantics).

## Agent and Subagent Lifecycle

The real structured model that exists **in the App** is the delegation receipt
(schema above), with these authoritative properties:

- Durable: launch + settle receipts are custom entries in the owner's SDK
  transcript; child transcripts are separate JSONLs under
  `<parentSessionDir>/.app-delegation/<root>/<owner>/`.
- Hierarchical: `owner` (direct parent) + `root` (app session) + `id`
  (delegation id, also the child's `agentId`) + `childSessionId`.
- Bounded: concurrency 4, depth 2, 32 launches/turn, 5 min/child,
  turn-scoped lifetime, fail-closed resume (`running` without a live job →
  `cancelled`).

What is authoritative **today** vs missing:

- Launch is visible live (the `task` tool result returns the running snapshot
  immediately).
- Transitions (completed/failed/cancelled) and results are persisted but **not
  evented**: the browser learns them only when the model next calls
  `subagent`/`task`, or after a reload via the transcript fold. Between those
  points the sidebar would be showing stale state — the one thing this audit
  exists to prevent.
- Child progress (streaming steps, current tool *inside* the child) is not
  transported at all; only the final ≤16 KB `resultText` exists.
- Browser frames carry no `runId` correlation, and the public receipt snapshot
  strips the hierarchy (`owner/root/childSessionId`).

The SDK-native alternative (allocated ids, registry, EventBus
`task:subagent:*`, `AgentProgress`, pause/steer) is a *different* system that
the App intentionally does not run; adopting any of it would be a policy
reversal, not a transport fix.

**Conclusion**: subagent identity, role, and lifecycle *concepts* exist and are
authoritative (receipts); live lifecycle *events* do not exist in the App path.
This is the genuine gap for an Agents section.

## Agent-to-Agent Communication

- GJC has real structured inter-agent messaging (IRC: tool + registry routing +
  `irc_message`/`subagent_steer_message` events with structured `details`).
- The App withholds the `irc` tool by recorded policy decision and does not
  forward the events; delegated children have IRC explicitly unavailable.
- What remains in the App: assignment-in / bounded-result-out per child, and
  `resume` follow-ups. That is a delegation contract, not a message channel.

Classification: **B** (exists in GJC, not transported — and withheld on
purpose). An Agent-communication UI must not be built from transcript text or
tools whose text mentions another agent (class E). Exposing IRC to the App is a
product/policy decision that this audit does not recommend; if ever wanted, the
transport already has a natural shape (`irc_message` → worker event → browser
frame), but nothing today needs it.

## What We Can Build Today

All class A/C, with zero runtime or protocol changes:

1. **Needs attention (waiting for the user)** — `needs_input` per session
   (approvals/permissions/questions, including delegation authorization) via
   the existing status model and attention store.
2. **Current work** — running state + `statusText` + current tool call
   (`tool_use` frames) for the visible session; todo-derived current task.
   (Render only authoritative status text; do not derive "blocked" labels.)
3. **Tasks** — `useSessionTodos` phases + `in_progress` current task.
4. **Agents** — a *settled-history* view: fold delegation receipts from
   `task`/`subagent` tool results in the transcript (id, role, description,
   status at last observation, resultText). Correct as history; explicitly not
   live.
5. **Review / recent activity** — unread finished/failed run outcomes
   (`ready`/`blocked`, viewed-clears) and delegation results (`resultText`)
   from the same fold. Not Needs attention: nothing is blocked on the user.
6. **Browser activity** — `BrowserSessionState` per session (state-mode WS).

Caveat to carry into any PR: the sidebar session rows already need the
attention/running signals, which exist; `session_upserted` cannot supply
status (and its `messageCount` is hardcoded `0`).

## Missing Capabilities

1. **Live delegation lifecycle events** — the only hard gap for a live Agents
   section. Receipt transitions happen inside the worker process
   (`GjcDelegationExecutor`) and never reach the worker protocol.
2. **Browser-frame run correlation** — `runId` is stripped at normalization;
   any live agents feed needs a stable per-run/per-delegation correlation id.
3. **Child progress/result streaming** — only final `resultText` exists
   (bounded, redacted by design). Any child detail view beyond the receipt is
   new capability.
4. **Agent-to-agent messaging** — withheld by policy (not a transport accident).
5. Not missing (do not add): todo change events; job-state attention semantics;
   any inference from tool durations/counts.

## Minimal Proposed Runtime Contract

**Research only — none of this is implemented here.**

One addition, shaped like the existing protocol rather than a new framework:

- **Event**: a worker-protocol event method (e.g. `delegation.updated`),
  emitted by `GjcDelegationExecutor` at receipt transitions (launch is already
  observable via the tool result; the new value is **settle**: terminal status
  + `resultText`).
- **Payload**: the *public* receipt snapshot (`id, agent, description,
  executionMode, repositoryBinding, status, resultText`) + the owning
  `appSessionId` scope the protocol already carries, and the run id for
  correlation. Decide once whether `owner/root/childSessionId` stay
  server-side-only or ride the frame (the sidebar needs at least `id` + parent
  scope; the hierarchy is recoverable server-side).
- **Event owner**: the executor (worker process), mirroring the receipt it is
  about to persist — emit adjacent to the existing `appendCustomEntry(RECEIPT)`
  so the event and the durable record cannot disagree.
- **Ordering**: within the session's existing event stream, after the
  launching `tool.started`/`tool.completed` pair; terminal events ordered
  before the run's `complete` frame (children are cancelled at turn end, and
  their cancellations should be visible before "done").
- **Transport/lifetime**: normalized by `gjc-worker-client` into one browser
  message kind that `chatRunRegistry.decorateRunEvent` stamps with
  `seq/replayGeneration` — it then inherits the existing replay buffer and
  reload semantics for free (live within the retention window; the durable
  history remains the transcript fold, which already exists client-side).
- **Persistence**: none new. The durable record is already the receipt custom
  entry; replay-after-restart is intentionally absent (restart cancels
  children — `running` receipts normalize to `cancelled`, and the reload fold
  will show exactly that).
- **Replay**: required only through the existing run-event replay (same window
  as every other message). No new store, table, or event bus.

Explicitly **not** proposed: exposing the SDK task system, IRC, child
streaming, new WS channels, or a generalized activity framework. If only one
event is added, add delegation settle; launch is already visible today.

## Recommended PR Sequence

Scope: this sequence delivers only the **agent/subagent activity capability**
this audit found missing. It is not the overall right-sidebar product
roadmap. Broader workspace context the product may want — environment, git
branch, changes, runtime, work/activity, user-required actions — can be
designed and implemented independently of this sequence, and nothing here
sequences or gates it.

1. **Client-only Agents/Review history section** — fold delegation receipts
   from existing `task`/`subagent` tool results (transcript + live tool
   results), render statuses with an "as of last update" caveat. No protocol
   change. Establishes the sidebar data plumbing and the fold helper where the
   live feed will land.
2. **Worker: `delegation.updated` event** — executor emits on settle (and
   optionally launch), worker-protocol method + validation + tests
   (`gjc-worker-protocol.ts`, `gjc-delegation-executor.ts`,
   `gjc-worker.test.ts`).
3. **Server→browser transport** — `gjc-worker-client` normalization to one
   message kind; replay/decoration tests (`gjc-worker-client.test.ts`,
   chat-run-registry tests); run-correlation id decided here.
4. **Live Agents section** — swap the fold's stale status for the event feed
   (fold remains the reload/history path); failed children surface under
   Review, not Needs attention — nothing waits for the user.
5. *(Optional, later, product-gated)* child result/progress surfacing and any
   agent-communication feature — separate decisions, not part of this sequence.

## Non-goals

- No AgentSidebar implementation, no new stores/components (this PR is docs
  only).
- No changes to Session A / Aside / Session B in-progress work; the
  `src/components/agent-sidebar/**` shell (on `main` since #62) is
  presentation-only and unmodified by this PR.
- No todo redesign; no moving TODO UI; no jobs UI revival; no browser
  architecture change; no SDK task-system adoption; no IRC enablement.
- No new websocket messages, SDK events, database columns, runtime events, or
  React stores in this PR — those belong to PRs 2–4 above after review.

## Appendix: classification of candidate sidebar fields

| Sidebar field | Class | Reasoning |
| --- | --- | --- |
| Needs attention: approval/question pending (per session) | A | server mirror `awaitingInput`; reload-safe |
| Review: failed run to review | A | `complete {success:false}` → `blocked` outcome |
| Review: finished run unread | A | `ready` outcome, viewed-clears |
| Needs attention: managed job `ready` | E | means "awaiting next turn", not user action |
| Current work: running / status text | A | run registry + SDK status frames |
| Current work: current tool call | A | `tool_use` frames |
| Current work: "agent is blocked" from tool duration | E | inference; runtime never says this |
| Current work: activity label from status text | E (display-only) | heuristic presentation, not state |
| Tasks: phase/task list | A | `todo_write` result `details.phases`, durable |
| Tasks: current task | C | exactly-one `in_progress` invariant |
| Agents: children spawned (id/role/description) | A (history) / B (live) | receipts at tool boundaries; no launch-time event (tool result arrives immediately, so near-live) |
| Agents: live status per child | B | transitions persisted but not evented |
| Agents: child result text | A (history, ≤16 KB) / B (at settle time) | `resultText` in receipt |
| Agents: child hierarchy (owner/root) | B | exists in receipts, stripped from public snapshot |
| Agents: child progress/current tool | D | not transported; new capability |
| Agents: "two tools running ⇒ two agents" | E | exactly the inference this audit forbids |
| Review: delegation results to review | A (history) / B (live) | same as child result text |
| Browser activity: tabs/URL/loading | A | `BrowserSessionState`, state-mode WS |
| Agent communication: messages between agents | B | exists in GJC (IRC), withheld by policy |
