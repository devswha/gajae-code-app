# Delegation Lifecycle Contract

Status: research/documentation only — no production code changed (2026-09-13).
Base: `main` at `b86e5bd` (PR #76 merged). App pins `@gajae-code/coding-agent`
**0.16.4** (`package.json:140`); GJC repository inspected read-only at 0.16.6.

Question answered: *what is the smallest authoritative lifecycle contract required
for compact Agent/Subagent activity in the production WORK context surface?*

This document is the delegation-specific deep dive. The broader per-surface
survey (including todos, browser, jobs, notifications) lives in
`docs/plans/agent-sidebar-activity-model.md`; the two are kept separate on
purpose and that file is not modified here.

Evidence convention: `path:line` refers to commit `b86e5bd`. SDK paths refer to
the installed `node_modules/@gajae-code/coding-agent/src` (0.16.4).

---

## 1. Executive finding

The App owns one delegation system: `GjcDelegationExecutor`
(`server/gjc-delegation-executor.ts`). It is **not** the GJC SDK-native task
system, not IRC, not Aside, and not the managed-jobs orchestrator. Its identity
and lifecycle record is the **delegation receipt**, a custom transcript entry
(`customType: 'gajae-app.delegation.v1'`) written twice per delegation into the
*owner's* SDK transcript: once at child start (`status: 'running'`), once at
settlement (`completed` / `failed` / `cancelled`).

- **Durable truth is already correct.** Every terminal transition is written to
  the owner transcript in the executor's settle path
  (`gjc-delegation-executor.ts:479-480`), with a deterministic restart rule
  (`running` receipt + no live job ⇒ `cancelled`, `:279`). The offline contract
  suite passes 27/27 at this commit (`server/gjc-delegation-executor.bun.test.ts`,
  bun 1.4.0, deterministic, no network).
- **The browser can already truthfully render `agent · running` live**, because
  the `task` tool result — delivered as a normal, durable tool result — carries
  `{subagents: [{id, agent, description, status: 'running', …}]}` at launch
  (`:175`, `:288-292`).
- **Exactly one live signal is missing: settlement.** When a child
  completes/fails/is cancelled while the parent turn continues, nothing crosses
  the worker protocol until the model happens to call `task`/`subagent` again.
  The executor has no notification channel at all
  (`GjcDelegationOptions`, `:83-90`, carries no writer or callback).
- **Reload reconstruction has a second, smaller hole**: receipts are durable but
  are *not projected* through the transcript REST read
  (`gjc-transcript-message.ts` handles only `type: 'message'` and the
  `skill-prompt` custom message), so a fire-and-forget delegation's last visible
  snapshot can say `running` forever.

The verdict (stated verbatim at the end): a minimal additive contract — one
live settlement event plus projection of the already-durable receipts. No new
store, no new framework, no protocol for a new task system, and no SDK
migration. Details in §10–§11.

---

## 2. Current App delegation architecture

### 2.1 What exists and what was replaced

`server/gjc-agent-tools.ts` partitions the runtime's builtin tools.
`GJC_AGENT_TOOL_NAMES` includes `task` and `subagent`
(`gjc-agent-tools.ts:45-46`) — but the adapter does not run the SDK builtins:

- `server/gjc-bun-sdk-adapter.ts:1074-1080` constructs a `GjcDelegationExecutor`
  when the run's `toolNames` include either name;
- `:1086` filters both names out of the `toolNames` handed to the SDK and
  installs `customTools: delegation.tools()` instead (`:1087`);
- `:1090` sets `spawns: delegation || goalEnabled ? 'deny' : …` so the SDK's own
  agent spawning cannot run either.

Why the SDK builtin executor must stay excluded:
`server/gjc-sdk-contract.bun.test.ts:1853` ("raw SDK builtin delegation bypasses
parent permissions; app replacement remains necessary") demonstrates the bypass
on 0.16.4. `docs/GJC-DELEGATION-CONTRACT.md:3-7` records this as a standing rule.

### 2.2 The executor

`GjcDelegationExecutor` (`gjc-delegation-executor.ts:140`) is constructed **per
run** (one parent turn) by the adapter and holds:

- `#jobs: Map<string, Job>` — live children only, worker memory (`:141`);
- `#root: Owner` — the root app session (`:150`);
- `#launches`, `#closed`, `#cleanupFailed` — admission and disposal state.

`Job = {receipt, owner, controller, session?, abortTask?, done, settled}`
(`:70-78`). Limits are frozen in `GJC_DELEGATION_LIMITS`
(`:81`): 4 concurrent children across the tree, depth 2, 32 launches per turn,
300 000 ms per child runtime.

Two custom tools are registered (`tools()`, `:153-221`):

- **`task`** (`:156-177`, `concurrency: 'exclusive'`): parse → owner/role checks
  → capacity check → repository-binding resolution → **authorization** →
  capacity re-check → launch. Accepts 1–4 tasks per call (`:45`). Returns
  immediately with `{subagents: [snapshot, …]}` where each snapshot has
  `status: 'running'` (`:175`, `:301`) — children run in the background
  (`job.done = this.#run(…)` `:305`).
- **`subagent`** (`:178-220`): actions `list | inspect | await | cancel | resume`
  (`:48`). `await` blocks on `#wait` (default 30 s, max 60 s, `all_terminal` or
  `any_terminal`) and then returns refreshed snapshots (`:209-218`). `resume`
  re-authorizes (`:200`) and relaunches a settled child reusing its identity.
  `cancel` cancels selected children.

### 2.3 Authorization (the ACTION REQUIRED path)

`#authorize` (`:251-268`) consults the run's `sdkPermissionMode`: `allow` ⇒ no
prompt; `prompt` ⇒ the run's permission provider; anything else ⇒ reject. The
provider call is `GjcBunAskController.requestPermission`
(`gjc-bun-permission-gate.ts:27`) with a **synthetic, correlatable id**:

- `toolCallId: 'delegation:<ownerSessionId>:<sdkToolCallId>'` (`:256`),
- `toolName: 'task'`, `title: 'Run delegated work using the selected model and
  credentials?'` (`:257`),
- options `allow_once | allow_always | reject_once` (`:260-262`).

This rides the ordinary permission pipe (`permission_request` frame,
`gjc-bun-ask-controller.ts:120-133`) and lands in the client's pending-input
attention state exactly like any other approval. No new surface is needed.

Children share the parent's ask bridge: the adapter passes
`delegation.setToolUIContext(askController.uiContext)` (`gjc-bun-sdk-adapter.ts:1079`)
and the child gets it in `#run` (`output.setToolUIContext(this.#ui, true)`,
`:445`). A child `ask` or tool-permission request therefore surfaces through the
same `sdk-permission:`/`sdk-ask:` frames as the parent's — with the child's real
tool name but no parent/child marker. That is today's behavior and this audit
does not widen it (§15).

### 2.4 Child sessions

`#run` (`:313-482`) creates each child directly with `createAgentSession` —
**not** through the SDK task executor:

- Child transcripts: `<parentSessionDir>/.app-delegation/<root>/<owner>/<file>.jsonl`
  (`:346`), path-contained and identity-checked on resume (`:348-358`).
- Child inherits the parent's exact model/effort/credential scope and tool
  policy (`:318-345`, `:409-443`); `goal`, `memory`, `compaction`, discovery,
  MCP, `ast_edit` and `task.eager` are forced off (`:337-344`); tool allowlist
  can only narrow (`:370-375`); `spawns: 'deny'` (`:418`).
- Grandchildren are possible up to depth 2: the executor re-registers its own
  tools for child owners (`:403-407`).
- The child subscribes **only** to its own `message_end` to capture
  `resultText` (≤ 16 000 chars) and `stopReason: 'error' ⇒ failed`
  (`:446-451`). Child events are never forwarded anywhere.

### 2.5 Ownership and lifecycle rules that already hold

- Receipts live in the *calling* transcript, so a resumed parent can only open
  children it actually created (class doc, `:135-139`; owner+root filter in
  `#receipts`, `:275-276`). Cross-session access is rejected
  ("Subagent is not owned by this session", `:189`).
- Children are turn-bounded: the adapter disposes the executor on turn end,
  abort, steer-settle and failure (`gjc-bun-sdk-adapter.ts:665, 827, 956,
  1293-1296`); `dispose()` cancels every live child (`:527-540`).
- A process restart or owner-turn disposal never resurrects background work:
  a `running` receipt with no live job reads as `cancelled` (`:279`).

---

## 3. GJC-native agent/task systems and their relationship

Five distinct concepts; only (2) is App-owned delegation.

| # | System | Where | Runs in the App? |
| --- | --- | --- | --- |
| 1 | Gajae App delegation receipts | `server/gjc-delegation-executor.ts` | **Yes — the subject of this audit** |
| 2 | SDK-native task/subagent system | SDK `src/task/*`, `tools/subagent.ts` | **No** (builtin `task`/`subagent` stripped, `spawns: 'deny'`) |
| 3 | GJC IRC / agent-to-agent messaging | SDK `tools/irc.ts`, `irc_message`/`subagent_steer_message` events | **No** (tool withheld by policy; events not forwarded) |
| 4 | Aside `exec` (agentic browser lane) | GJC runtime browser backend | Runs inside *child and parent tool calls*; it is a tool, not a delegation lifecycle |
| 5 | Concurrent ordinary tool calls | SDK tool scheduler | Unrelated; `concurrency: 'exclusive'` on `task`/`subagent` (SDK `extensibility/custom-tools/types.ts:185-186`) serializes them within a model turn |

### 3.1 SDK-native task system (documented, not used)

The SDK ships a complete subagent runtime used by its own CLI/TUI:

- Allocated ids `^\d+-<name>(\.\d+-<name>)*$` and a process-wide `AgentRegistry`
  (SDK `task/id.ts`, `registry/agent-registry.ts`).
- `AgentProgress.status = pending | running | completed | failed | aborted |
  paused` (SDK `task/types.ts:275`) and
  `SubagentLifecyclePayload.status = started | completed | failed | aborted |
  paused` (`task/types.ts:63-68`).
- A dedicated **EventBus** returned by `createAgentSession`
  (`sdk/session.ts:658`) with channels `task:subagent:event | progress |
  lifecycle` (`task/types.ts:43-49`), emitted from the SDK task executor
  (`task/executor.ts:1235, 1392, 2063, 2663`), plus `TaskToolDetails.progress`
  riding `tool_execution_update`, background `AsyncJobManager` jobs, worktree
  execution and a `subagent` control tool with `pause`/`steer`.

**Boundary statement.** The App's `GjcDelegationExecutor` is a separate
App-owned abstraction. Because the builtin `task`/`subagent` tools never run in
an App session (`gjc-bun-sdk-adapter.ts:1086`), the SDK task executor never
executes, and therefore `task:subagent:*` events **never fire** for App
delegations — not "fire but get dropped": the producing code path is absent.
Conversely the App executor's children are plain `createAgentSession` sessions
whose events only the executor itself subscribes to.

**Can it be reused?** No, not for this purpose. Wiring the SDK event bus into
the App would require actually running the SDK task executor, which the App
deliberately does not (parent-permission bypass, `gjc-sdk-contract.bun.test.ts:1853`).
The bus is also process-local and (for CLI background jobs) process-lifetime.
Migrating the App onto the SDK task system would be a separate architectural
decision with security implications — explicitly out of scope (§17), and not
needed: the App's own receipts already carry strictly more lifecycle truth than
the SDK bus would give a non-SDK executor.

### 3.2 IRC (documented, withheld)

`GJC_AGENT_TOOLS_WITHHELD['irc'] = 'Network chat unrelated to coding in this
app.'` (`gjc-agent-tools.ts`). The runtime's `irc_message` /
`subagent_steer_message` session events (SDK `session/agent-session.ts:22868,
22893, 22935`) are not in the App's forwarded whitelist
(`gjc-bun-sdk-events.ts:23-34`), and delegated children are told "yield and IRC
are unavailable" (`gjc-delegation-executor.ts:428`). See §16 for the boundary
this audit keeps.

---

## 4. End-to-end lifecycle trace

One delegation, launch to settlement, with every producer/consumer boundary.

```text
[worker process (Bun)]                         [server process]                [browser]
model emits task toolCall
  SDK tool_execution_start(task)
    → gjc-bun-sdk-events.ts:255  tool_use frame
    → gjc-worker.ts:552          event tool.started ──▶ gjc-worker-client.ts:1314
    → run.writer.send ──▶ ChatSessionWriter broadcast | job appendEvent+publish
    → client tool card (Default config)
task.execute (gjc-delegation-executor.ts:159)
  #authorize (:170) ── permission_request frame ("delegation:<owner>:<callId>")
    ← ask.reply (user allows)                     ← ACTION REQUIRED resolves
  #launch (:173) → Job{receipt status:'running'} (:301)
    #run in background (:305):
      child SessionManager.create (:360) → childSessionId, file (:361-362)
      durable write #1: appendCustomEntry('gajae-app.delegation.v1', receipt)
        + flush (:364-365)                       [owner transcript: running]
      createAgentSession(child) (:409) … session.prompt (:456)
      child message_end → resultText/status capture (:446-451)   [not forwarded]
      … child runs (minutes, ≤300 s) …
SDK tool_execution_end(task)  [launch returns immediately]
  → tool_result frame, isFinal, toolUseResult = {subagents:[{…status:'running'}]}
  → gjc-worker.ts:553 tool.completed ──▶ … ──▶ client message window   ← LIVE "running"
      [durable: SDK transcript tool result + (worktree runs) job event log]

  … NOTHING crosses the wire while the child runs …

  settle (#run finally, :463-481):
    completed (:458) | failed (:450,:460-462,:476) | cancelled (:478)
    descendants stopped, child session disposed (:467-477)
    durable write #2: appendCustomEntry(RECEIPT, receipt)+flush (:479-480)
    ★ no notification channel exists — this is the gap (§8)

next task/subagent tool call (whenever the model makes it):
  #receipts refresh (:217) → snapshot with terminal status → tool_result frame
  [this is the ONLY way settlement becomes visible today]
turn end: run.delegation?.dispose() (adapter :665/:827/:956/:1293)
  → all live children cancelled → terminal receipts appended (same ★ gap)
```

Reload today: `GET /api/providers/sessions/:id/messages` re-reads the SDK JSONL.
Tool results survive with their structured details
(`gjc-sessions.provider.ts:409-426`, asserted in
`server/modules/providers/tests/gjc-sessions.test.ts:896-957`); **receipt custom
entries are skipped** (`gjc-transcript-message.ts` accepts only `type:'message'`
and `skill-prompt`).

---

## 5. Receipt/data model

Exact type (`gjc-delegation-executor.ts:55-67`):

```ts
const receiptSchema = z.object({
  id: uuid,                    // delegation id; also the child's SDK agentId (:412)
  owner: uuid,                 // direct parent SDK session id
  root: uuid,                  // root app SDK session id
  childSessionId: uuid,        // the child's own GJC session id
  file: string,                // child transcript basename under .app-delegation/
  agent: /^[a-z][a-z0-9-]{0,63}$/,   // bundled role (getBundledAgent, :240)
  executionMode?: 'default' | 'ultragoal-red-team',
  repositoryBinding: taskItemSchema.shape.repositoryBinding,
  description: string,         // task label (≤1000 chars at input, :39)
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  resultText: z.string().max(16_000),
});
```

- **Where written**: owner's SDK transcript only, via
  `owner.manager.appendCustomEntry('gajae-app.delegation.v1', { …receipt })`.
  Exactly two appends per delegation: start (`:364`) and settle (`:479`). The
  entry is a shallow **copy**; the live `Job.receipt` object is mutated in place
  between them. Reads are append-only, **last entry per `id` wins**
  (`#receipts` iterates all entries into a `Map`, `:272-281`).
- **When status changes**: `running` at launch (`:301`); `failed` on child
  `stopReason:'error'` (`:450`) or any thrown setup/prompt/cleanup error
  (`:460-462`, `:476`); `completed` when `prompt()` resolves while still running
  (`:458`); `cancelled` when the job's abort signal or the executor's closed
  signal fired (`:478`). Terminal state is **durable** (flushed, `:480`).
- **Failure text is sanitized by design**: SDK exceptions can carry provider
  payloads/credentials, so failed receipts carry a fixed string
  (`:461-462`); tests assert no credential material ever reaches receipts
  (`gjc-delegation-executor.bun.test.ts:406-408, 769-771`).
- **Public shape**: `#snapshot` (`:288-292`) strips `file`, `owner`, `root`,
  `childSessionId` and overlays live status. Tool results therefore expose
  `{id, agent, executionMode?, repositoryBinding, description, status,
  resultText}`. The redaction exists because tool results enter the *model's*
  context; it is not a statement about browser safety.
- **Restart normalization**: `#receipts` maps `running` ⇒ `cancelled` when no
  live job exists (`:279`). Applied lazily — only when a `task`/`subagent` call
  next reads receipts, never proactively.

---

## 6. Client-visible signals today

What actually reaches the browser, by channel:

| Channel | Carries | Live | Durable | Reload |
| --- | --- | --- | --- | --- |
| `tool.started` for `task`/`subagent` | the model's request (`toolInput`) | ✔ | ✔ (SDK transcript `tool_use`) | ✔ REST |
| `tool.completed` for `task` | `{subagents: [snapshot status:'running']}` in `toolUseResult` | ✔ at launch | ✔ | ✔ REST (`details` slot) |
| `tool.completed` for `subagent` (await/inspect/list) | refreshed snapshots incl. terminal statuses | ✔ **only when the model calls it** | ✔ | ✔ REST |
| `permission_request` / `permission_cancelled` | delegation authorization (`delegation:` id prefix), child asks/permissions | ✔ | pending mirror (`chat-run-registry`), cleared on resolve | ✔ while the run lives (`chat_subscribed.pendingPermissions`) |
| `usage.updated` / status frames | session facts, goal snapshot — **nothing delegation-specific** | ✔ | ✖ (chat path: broadcast-only; `ChatSessionWriter` persists nothing) | ✖ |
| Receipt custom entries | full authoritative record | ✖ **never transported** | ✔ (SDK JSONL) | ✖ **not projected by the transcript reader** |

Client-side landing points: message window + `toolUseResult` merge
(`src/stores/useSessionStore.ts:10, 50, 70`), tool cards via
`TOOL_CONFIGS` — note **`task`/`subagent` have no dedicated card** and render
through `Default` (`src/components/chat/tools/configs/toolConfigs.ts:113-134`).
No client code projects delegation lifecycle: `AgentSidebarWork` renders only the
`todo_write` fold plus the selected session's running flag
(`src/components/agent-sidebar/view/AgentSidebarWork.tsx`). The transcript work
block counts a `subagent` *tool-call category*
(`src/components/chat/utils/turnWork.ts:220, 260`) — a tally of calls, not
lifecycle.

**Can the client render `Agent A · running` truthfully while the child
executes?** Yes — from the `task` tool result, which is authoritative at that
moment (`status:'running'` is the receipt's actual state, not an inference).
**Can it learn the child finished without the model asking?** No. The missing
transition is settlement (and cancel-at-turn-end) — §8.

---

## 7. Authority table

A = authoritative · D = deterministically derived from authoritative structured
data · H = heuristic · M = missing.

| Signal | Class | Evidence |
| --- | --- | --- |
| delegation exists | **A** (receipt entry); client today: **D** via `task` tool result | `:364`, `:175` |
| delegation authorized | **A** (permission outcome precedes launch; rejection throws before any child exists) | `:170, 251-268`; `gjc-delegation-executor.bun.test.ts:268-281` (denied delegation creates zero children) |
| child session id | **A** in receipt; **M** on the wire (stripped by `#snapshot`) | `:59, 289` |
| agent name/type | **A** (`receipt.agent`, validated against bundled roles) | `:61, 240` |
| description / task label | **A** (`receipt.description`, bounded input) | `:39, 64` |
| queued | **M** — no such state exists; launch is synchronous into `#run` | `:294-311` |
| starting (distinct from running) | **M** — the `running` receipt is written at child-session creation; the executor cannot distinguish "created session" from "model streaming" as separate statuses | `:360-365` |
| running | **A** (receipt `running` + live `Job.settled=false` overlay) | `:301, 291` |
| settling | **M** as a delegation state (worker `activity.settling` is run-level, `gjc-worker-protocol.ts:67-78`) | — |
| completed | **A** (terminal receipt entry) | `:458, 479` |
| failed | **A** (terminal receipt entry, sanitized text) | `:460-462, 476` |
| cancelled / aborted | **A** (terminal receipt entry) | `:478` |
| result text | **A** (≤16 kB from child `message_end`) | `:448-449` |
| owner session | **A** in receipt; **M** on the wire | `:57, 289` |
| root session | **A** in receipt; **M** on the wire | `:58, 289` |
| multiple active delegations | **A** (1–4 tasks per call; ≤4 live across the tree) | `:45, 81, 243-249` |
| replay after reconnect (same page/socket) | chat: **D** — in-memory replay buffer + REST refetch of durable tool results; worktree runs: **A** — every writer frame is appended to the durable job event log (`gjc-job-orchestrator.ts:201-230`) | `chat-websocket.service.ts`; `gjc-job-orchestrator.ts:206-208` |
| reconstruction after full client reload | **D but stale-prone** — folds durable tool-result snapshots; receipts (the current truth) are not projected, so a delegation the model never re-polled stays `running` on screen | `gjc-transcript-message.ts`; §6 table |
| reconstruction after server/worker restart | **A rule exists** (`running` + no live job ⇒ `cancelled`, `:279`) but is applied lazily inside the executor only; the client never sees it ⇒ effectively **M** client-side until projected | `:279` |

Nothing in the table requires an H. The hard rule holds: no production signal
here is derived from transcript prose, tool-call timing, or child-transcript
activity — and none needs to be.

---

## 8. Exact lifecycle gap

The narrowest point where the App knows "this delegation transitioned from
running to terminal" is **`GjcDelegationExecutor.#run`'s `finally` block**
(`gjc-delegation-executor.ts:463-481`) — one place, covering all three terminal
statuses, after descendants are stopped and the child session is disposed,
immediately before/with the durable terminal receipt append (`:479-480`).

- **Producer**: `GjcDelegationExecutor` (worker process).
- **Current state mutation**: `job.receipt.status` + `appendCustomEntry` +
  `flush` — durable, correct, and already tested.
- **Transport boundary**: none exists. `GjcDelegationOptions`
  (`:83-90` = `{parent, session, sessionOptions, permissionProvider,
  createSession}`) carries **no writer, no callback, no event sink**. The
  executor is structurally incapable of notifying anyone.
- **Missing event**: one notification per settlement, carrying the receipt's
  public snapshot, from that `finally` block to the run's writer.
- **Consumer**: `gjc-bun-sdk-adapter.ts` owns both the executor (`:1075`) and
  the run writer (`:1156-1161` area) — it is the natural injection point.

This **confirms** the earlier hypothesis (durable receipts, one missing live
settlement notification) and adds one nuance: reconnect/reload truth additionally
requires projecting the receipts themselves (§11), because tool-result snapshots
go stale and the restart rule currently lives only inside the executor.

Launch needs **no** new event: the `task`/`subagent resume` tool results already
transport `running` snapshots synchronously and durably, and adding a
launch event would duplicate that. Queued/starting events would be fake
precision — those states do not exist (§7).

---

## 9. Recommended ownership boundary

- **System of record**: the delegation receipt in the owner's SDK transcript.
  Unchanged. No new database, no new global store, no second copy of result
  text.
- **Live transition transport**: the existing worker event pipeline
  (executor → adapter writer → worker event → worker-client → run writer →
  chat broadcast / job event log). One new event method, one new writer kind.
- **Reload/reconnect authority**: the same receipts, projected through the
  existing GJC transcript REST read — the same place tool results are already
  normalized (`gjc-sessions.provider.ts`). The client folds receipts exactly as
  it folds `todo_write` results out of the same message window
  (`useSessionTodos` precedent); the WORK lane stays a projection with no state
  of its own (`AgentSidebarWork` already documents this stance).
- **Not owned by this contract**: child progress streaming, child tool traffic,
  inter-agent messaging, background/detached work, pause/steer. The delegation
  contract is assignment-in / one bounded result-out / terminal status
  (`docs/GJC-DELEGATION-CONTRACT.md:31-35`).

---

## 10. Minimal additive contract

Derived from the App's existing worker event/replay conventions
(`docs/GJC-WORKER-PROTOCOL.md`; `gjc-worker-protocol.ts:29-43`), not assumed:

**One new scoped worker event method — `delegation.updated`.**

- Naming follows the existing `<domain>.<past-tense>` pattern
  (`session.created`, `tool.completed`, `usage.updated`,
  `provider.auth.updated`).
- Wire path mirrors `tool.completed`: executor settle callback → writer message
  `{kind: 'delegation_updated', …}` → `gjc-worker.ts #normalized` maps it to
  event `delegation.updated` (a mapping is *required*: unmapped kinds default to
  `message.completed`, `gjc-worker.ts:550`) → `gjc-worker-client.ts` relays
  `payload.message` to the run writer generically (`:1312-1318`) →
  `ChatSessionWriter` broadcast (chat runs) **and** durable `jobs.appendEvent` +
  `gjc_job_event` publish (worktree runs — free, `gjc-job-orchestrator.ts:214-219`).
- Scope: per run/session like other run events; the frame's session scope
  already correlates the delegation to the app session, so owner/root need not
  ride the payload.

Payload — the receipt's **public snapshot** plus stable identity, nothing more:

```ts
{
  delegationId: string;        // receipt.id (uuid) — stable across resume
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  agent: string;               // bundled role
  description: string;
  executionMode?: 'default' | 'ultragoal-red-team';
  repositoryBinding?: Receipt['repositoryBinding'];
}
```

Deliberately excluded:

- `resultText` — the durable receipt and the collecting tool result own it;
  duplicating it in every event is exactly the redundancy to avoid. (The model,
  not the sidebar, consumes child results.)
- `file`, `owner`, `root`, `childSessionId` — not needed by any consumer in this
  contract; the frame scope identifies the owning session and the receipt
  remains the full record. (The `#snapshot` redaction rationale is
  model-context safety; if a future consumer genuinely needs `childSessionId`,
  adding it to a browser-scoped event is a reviewed decision, not a default.)
- queued/starting/settling — those states do not exist (§7); the contract must
  not pretend they do.

**Emission points (exhaustive):**

| Transition | Emit? | Why |
| --- | --- | --- |
| receipt created (`:364`) | **No** | the `task`/`resume` tool result transports the `running` snapshot synchronously and durably |
| authorization granted | **No** | already visible as the permission resolution on the existing channel |
| queued / starting | **No** | states do not exist |
| completed / failed / cancelled (`:479`) | **Yes — the one emission point** | today invisible until an arbitrary later tool call |
| parent run abort / turn end ⇒ `dispose()` ⇒ cancel | covered by the same settle path | `:478` |
| server shutdown / worker restart | **Cannot emit** (process gone) | covered by the restart fold rule (§11), not by an event |

So the contract is: *durable receipt (unchanged) + one `delegation.updated`
event at settlement + receipt projection for reload.* Nothing else.

---

## 11. Replay/reconnect semantics

Model **A: durable receipt snapshot + live update event** — chosen over event
replay alone (events are incomplete: launch rides tool results; restart emits
nothing), over transcript derivation alone (stale, §6), and over any new
projection store (unnecessary; receipts already exist).

1. **Live**: `delegation.updated` flows through the existing per-run pipeline.
   Chat-viewer reconnect inside the in-memory replay window replays buffered
   frames; beyond it the REST refetch (next point) is authoritative. Worktree
   runs get durable ordered replay from the job event log for free.
2. **Reload**: the GJC transcript REST read projects `gajae-app.delegation.v1`
   entries alongside messages (extend `gjc-sessions.provider.ts` /
   `gjc-transcript-message.ts`; the reader currently accepts only `message` and
   `skill-prompt`). Receipts are append-only with last-per-`id` semantics — the
   fold is a deterministic reducer, and it supersedes any stale tool-result
   snapshot for the same `delegationId`.
3. **Reconciliation rule (restart)**: fold the last receipt entry per
   `delegationId`; a `running` receipt is trusted **only while its session has
   an active run** in the server run registry (`chat-run-registry`; surfaced as
   `GET /api/providers/sessions/running`). No active run ⇒ `cancelled`. This is
   the executor's own rule (`:279`) applied at read time — a deterministic
   derivation (D) from two authoritative inputs, not a heuristic, and not a
   timer.
4. **Ordering**: live events upsert by `delegationId` and are idempotent against
   the fold; a late event after a reload simply matches the folded terminal
   state. The UI can therefore never show a permanently-running agent after a
   reconnect that missed a settlement: either the terminal receipt entry is
   already in the transcript (folded on reload), or the run is gone (rule 3).

---

## 12. Cancellation / abort semantics

All paths end in the same settle block, so one event shape covers them:

- **User/model cancel** (`subagent` action `cancel`, `:207-208`): `#cancel`
  aborts the job controller and the child session, cancels descendants, awaits
  `job.done` (`:515-521`) ⇒ `cancelled` (`:478`).
- **Runtime cap**: 300 s timer triggers the same `#cancel` (`:315`).
- **Turn end / run abort / run failure**: adapter `dispose()` paths
  (`gjc-bun-sdk-adapter.ts:665, 827, 956, 1293-1296`) cancel every live child.
- **Failed abort is not a false terminal**: a rejected SDK abort surfaces
  "Delegated cancellation failed. Retry cancellation." and the child stays
  `running` until it really stops (`:506-513`, `:527-540`; asserted in
  `gjc-delegation-executor.bun.test.ts:392-401, 446-450`). The contract must
  preserve this: **no terminal event without a terminal receipt**, and a
  cancelled-looking child that is still running is a bug.
- **Worker/server death**: children die with the process (the SDK is embedded
  in-process in the worker). No event is possible; the fold rule (§11.3) is the
  truth. The settle event therefore never needs a "probably stopped" variant.

---

## 13. Multiple-child semantics

- Multiple concurrent children are first-class: 1–4 tasks per `task` call
  (`:45`), ≤4 live across the whole tree (`:243-249`), 32 launches per turn,
  depth 2 (grandchildren allowed).
- **Stable identity is `receipt.id`** — a uuid assigned at first launch and
  reused on `resume` (`previous?.id`, `:296`); `childSessionId` and `file` are
  likewise reused (`:298`, identity-checked `:355-358`; asserted across
  dispose/resume in `gjc-delegation-executor.bun.test.ts:244-262`). The
  projection keys rows by `delegationId`; `agent` + `description` are labels,
  not keys (a role may run twice).
- **Ownership scoping**: receipts are filtered to `owner === this session &&
  root === root session` (`:275-276`). A root session's WORK lane therefore
  shows only its *direct* children; a grandchild's receipt lives in the child
  owner's transcript and is deliberately out of the root's lane (the root's
  `inspect` cannot even see it, `:358`).
- Compact summary ("2 agents active") = count of receipts with `status:
  'running'` for the selected session — a fold over authoritative data, exact
  by construction, no estimation.

---

## 14. Future WORK presentation (constraints, not layout)

- WORK today renders the `todo_write` fold plus the selected session's running
  flag (`AgentSidebarWork.tsx`); delegation rows would join as a second
  projection over the same message window, owning no state.
- TODOs and delegations stay separate models (§"Relationship to TODOs" below):
  todos are user-visible plan state from `todo_write` results; delegations are
  execution activity from receipts. Any `● phase` + `Agents` composition is
  presentational layering, not a merged data model.
- **Running children** belong in WORK while their owning run is active.
- **Terminal children**: keep visible only while the owning operation is still
  in flight — the natural boundary is the owning run itself (when the run ends,
  every child is terminal by the dispose rule, and the lane collapses with it).
  No timers, no retention window, no history. `failed` is worth a row for the
  same reason the model needs it: it explains what the owner is doing about it
  mid-turn.
- **Completed/failed are never ACTION REQUIRED merely because they ended** (§15).

---

## 15. ACTION REQUIRED boundary

Unchanged by this contract:

- ACTION REQUIRED projects only real unanswered requests —
  `useSessionAttentionStore.pendingInput[sessionId].requestIds`
  (`AgentSidebarActionRequired.tsx`; reconcile in
  `useSessionAttentionStore.ts:166-178`).
- **Delegation authorization is already there**: it is an ordinary
  `sdk-permission:` request whose `context.toolCallId` carries the
  `delegation:<owner>:<callId>` prefix (`:256`), so the lane, the banner and
  the card correlate without new machinery.
- Once authorized: running child activity ⇒ WORK; completed child ⇒ nothing in
  ACTION REQUIRED; failed child ⇒ nothing in ACTION REQUIRED.
- A child that later needs a user question or approval already surfaces through
  the existing authoritative channel (the shared ask bridge, §2.3). Delegation
  status must never be re-interpreted as a second "needs attention" signal.
- Known wrinkle, deliberately out of scope: child permission frames carry the
  child's real tool name with no parent/child marker, so a child approval is
  indistinguishable from a parent approval in the lane. Changing that is a
  separate, explicit decision.

---

## 16. IRC boundary

- Product/tool policy withholds `irc` (`GJC_AGENT_TOOLS_WITHHELD`,
  `gjc-agent-tools.ts`); the runtime's `irc_message` /
  `subagent_steer_message` events are not forwarded
  (`gjc-bun-sdk-events.ts:23-34`); delegated children are explicitly told IRC is
  unavailable (`:428`).
- This audit is independent of IRC enablement. If IRC is ever enabled, it is
  **coordination detail** — message content between agents — and must never
  become the authoritative source of child lifecycle. The receipt remains the
  lifecycle authority; an IRC message saying "done" is prose, not state.
- Concretely: do not derive `status` from IRC traffic, and do not route
  `delegation.updated` through IRC channels.

---

## 17. Explicit non-goals

- No sidebar UI in this PR (WORK agent rows are PR B).
- No SDK-native task/subagent enablement, no `AsyncJobManager`, no `spawns`.
- No IRC enablement or IRC-derived state.
- No Aside or built-in-browser changes (Aside `exec` remains a tool inside
  turns, not a lifecycle system).
- No change to delegation authorization, limits, credential scoping or the
  permission pipe.
- No new global store (`AgentRuntimeState`-style), no delegation database, no
  duplicate task protocol.
- No transcript-text parsing, tool-call timing, child-transcript activity or
  concurrent-tool-count inference — investigation only, never production truth.
- No timers, retention windows or agent history.
- No pause/steer/progress-streaming for children (deliberately absent from the
  App contract today).

---

## 18. Recommended implementation PR sequence

Both PRs belong to **devswha/gajae-code-app**. The GJC repository
(Yeachan-Heo/gajae-code) needs **no change** — the contract is App-owned end to
end (executor, worker protocol, client).

**PR A — `feat(gjc): authoritative delegation lifecycle updates`** (server
contract; no UI):

1. `GjcDelegationOptions` gains a settle notification; `#run`'s `finally` block
   invokes it once per receipt with the public snapshot (§10 payload).
2. Adapter wires it to the run writer as `{kind: 'delegation_updated', …}`.
3. Worker: add `delegation.updated` to `GJC_WORKER_EVENT_METHODS`
   (`gjc-worker-protocol.ts:29-43`), map the new writer kind in
   `gjc-worker.ts #normalized` (explicit mapping — unmapped kinds default to
   `message.completed`), update `docs/GJC-WORKER-PROTOCOL.md` §Events and the
   conformance/spec tests (`gjc-worker-protocol.test.ts`,
   `gjc-worker-protocol-spec.test.ts`, `gjc-worker.test.ts`).
4. Durable replay: project `gajae-app.delegation.v1` entries through the GJC
   transcript history read (`gjc-sessions.provider.ts` /
   `gjc-transcript-message.ts`) with the restart fold rule (§11.3); tests in
   `server/modules/providers/tests/gjc-sessions.test.ts`; extend the offline
   delegation suite (`gjc-delegation-executor.bun.test.ts`) to assert the
   notification fires exactly once per settle and never without a terminal
   receipt.
5. Docs: `GJC-LIVE-SPEC.md`, `GJC-DELEGATION-CONTRACT.md` gain the event and
   the fold rule.

**PR B — `feat(agents): project delegation lifecycle into WORK`** (client):

1. Session-store fold of projected receipts + live `delegation.updated`
   (idempotent upsert by `delegationId`; receipts supersede stale tool-result
   snapshots).
2. Compact agent rows in `AgentSidebarWork` (per-agent `agent · status` and the
   `N agents active` summary), i18n keys, DOM tests
   (`*.dom.bun.test.tsx`), no new store.

---

## Result

The durable receipt is already the correct authority; the App lacks exactly one
live settlement notification and one projection of the receipts for reload. An
additive event plus a fold is sufficient; a new store, a delegation database, a
duplicate task protocol, transcript parsing, or a migration onto the SDK-native
subagent system are not necessary and are explicitly rejected here.

AUDIT RESULT: MINIMAL_CONTRACT_REQUIRED
