# Aside browser activity contract

Status: research/design only — no production code changed (2026-09-13).
Question answered: **what is the smallest authoritative path for showing live
Aside activity in WORK?**

The production right context surface is ENVIRONMENT / WORK / ACTION REQUIRED
(`src/components/agent-sidebar/view/AgentSidebar.tsx`, default since #76). WORK
today projects two authoritative sources: the `todo_write` phases fold
(`src/components/chat/hooks/useSessionTodos.ts`) and the session's running
state (`src/contexts/SessionStatusContext.tsx`). This document determines what
it would take to add rows such as:

```text
WORK

● Browser · Aside
  Working in the browser
```

without parsing Bash command strings and without inventing heuristics.

Evidence base:

- GJC (Yeachan-Heo/gajae-code) inspected at `f6b7c47` (version 0.16.6); line
  numbers below are upstream. The app pins `@gajae-code/coding-agent`
  **0.16.4**, and the entire Aside routing path is **byte-identical** between
  the pinned copy in this repo's `node_modules` and upstream:
  `browser-backend.ts`, `prompts/agent-fragments/browser-aside.md`,
  `tools/descriptors.ts`, `slash-commands/helpers/aside.ts`,
  `config/settings-schema.ts`. `tools/bash.ts`, `exec/bash-executor.ts` and
  `extensibility/extensions/types.ts` carry unrelated upstream churn; every
  symbol cited from them (`BashToolInput`, `BashToolDetails`,
  `#buildResultText`, the `async` job details, `ToolExecution*Event`,
  `BashResult`) was verified present in the pinned 0.16.4 copy.
- App inspected at `main` after #76 (`b86e5bd`).
- Live-trace evidence reused from `docs/BROWSER-ASIDE-POC.md` (2026-09-12,
  Aside CLI 1.26.810.1915). No paid or live Aside run was performed for this
  audit; nothing below depends on one.

## 1. Current architecture

```text
App Settings (automation.browserBackend.v1: builtin | aside)
  └─ server enrichGjcSdkRunOptions → run option browserBackend
      └─ server/gjc-bun-sdk-adapter.ts applyGjcBrowserBackend   (settings.override)
          ├─ builtin → browser.backend=native, app WebView tool kept when ready
          └─ aside   → probeAsideCli() → refuse (aside_unavailable) or
                       browser.backend=aside + app browser transport withheld
              └─ GJC runtime: hide `browser` tool, append <browser-backend> prompt
                  └─ the MODEL routes browser tasks itself through the Bash tool
                      └─ user-installed Aside CLI (~/.local/bin/aside)
                          └─ Aside browser
```

Transport for anything the sidebar could show:

```text
SDK session.subscribe (in-process, Bun worker)
  └─ server/gjc-bun-sdk-events.ts  forwardSdkEvent — whitelisted SDK events
  └─ server/gjc-worker.ts          Protocol v1 (tool.started / tool.completed)
  └─ server/gjc-worker-client.ts   normalize → browser message kinds
  └─ chat-run-registry.service.ts  seq + replayGeneration, replay buffer
  └─ src/stores/useSessionStore.ts message windows (reload: REST transcript)
  └─ AgentSidebarWork (todos fold + running)
```

## 2. Exact GJC Aside execution path

Everything Aside that exists in the runtime, traced to source:

1. **Setting.** `browser.backend: "native" | "aside"`
   (`packages/coding-agent/src/config/settings-schema.ts:3081`). Default
   `native`. Strictly opt-in.
2. **Backend resolution.** `resolveBrowserBackend(settings)` returns a
   `BrowserBackend { id, exposesBuiltinTool, developerInstructions? }`
   (`packages/coding-agent/src/browser-backend.ts`). For `aside`:
   `exposesBuiltinTool: false` and `developerInstructions` = the trimmed
   `browser-aside.md` fragment.
3. **Tool hiding.** `availableFor("browser")` in
   `packages/coding-agent/src/tools/descriptors.ts:264-267` requires
   `exposesBuiltinTool`, so with `aside` the built-in Puppeteer browser tool is
   neither active nor discoverable.
4. **Prompt injection.** `createAgentSession` appends
   `browserBackend.developerInstructions` to the system prompt
   (`packages/coding-agent/src/sdk/session.ts:4019-4021`).
5. **The routing contract itself** is that prompt fragment,
   `packages/coding-agent/src/prompts/agent-fragments/browser-aside.md`:
   - every rendered/authenticated browser task "MUST use Bash to invoke the
     installed Aside CLI";
   - "Default to `aside repl '<JavaScript>'`" for deterministic Playwright
     work;
   - "`aside exec '<prompt>'` only for runtime judgment, source-heavy
     research, browser-history search, MFA or opaque password autofill,
     approval/notification waits, long monitoring, multi-site synthesis,
     routines, or work worth a second model", continuing with
     `aside exec --session <id>`;
   - "Load the installed GJC `aside` skill before a browser job when
     available".
6. **CLI discovery** (not execution): `/aside` composer command
   (`packages/coding-agent/src/slash-commands/helpers/aside.ts`) —
   `asideCliCandidates` / `resolveAsideCliPath` / `probeAsideCli`, MCP
   registration formatting, and a `/aside exec` passthrough with a 10-minute
   timeout (`ASIDE_EXEC_TIMEOUT_MS`). `/aside repl` is refused in the composer
   (no TTY). This is user-facing CLI ergonomics, **not** part of a run.
7. **Skill.** The user-installed `aside` skill under `<agentDir>/skills/aside`
   (`~/.gjc/agent/skills` by default) is loaded through the ordinary `skill`
   tool; the runtime does not ship it
   (`docs/BROWSER-ASIDE-POC.md` finding 3, verified live).
8. **Execution is an ordinary Bash tool call.** `BashToolInput`
   (`packages/coding-agent/src/tools/bash.ts:484-506`) is
   `{command, env?, timeout?, cwd?, async?, pty?}` — the command is an opaque
   string. The result is `{content, details}` where
   `BashToolDetails { meta?, timeoutSeconds?, requestedTimeoutSeconds?,
   terminalId?, foldReason?, async?: {state, jobId, type: "bash"} }`
   (`bash.ts:508-520`). Nothing in input or details says what the command is.
9. **Where `repl` vs `exec` is chosen: nowhere in code.** The mode exists only
   as characters inside the model-authored command string, produced by the
   model following the prompt fragment. No runtime symbol, event, field or
   metadata distinguishes the two. (The only structural `exec` invocation is
   the user's `/aside exec` slash command — outside runs entirely.)
10. **Tool lifecycle events.** `ToolExecutionStartEvent {toolCallId, toolName,
    args, intent?}`, `ToolExecutionUpdateEvent {toolCallId, toolName, args,
    partialResult}`, `ToolExecutionEndEvent {toolCallId, toolName, result,
    isError}` (`packages/coding-agent/src/extensibility/extensions/types.ts:818-843`).
    `intent` is the model's `_i` reasoning string — "a model-facing reasoning
    aid, not a UI feature", setting-gated and absent for sub-sessions
    (`sdk/session.ts:1216-1231`).
11. **Background/monitor jobs.** Long Bash work can fold to a background job:
    auto-background threshold 60 s (`bash.ts:107`,
    `DEFAULT_AUTO_BACKGROUND_THRESHOLD_MS`), progress frames carry
    `async: {state: "running", jobId, type: "bash"}` (`bash.ts:1680`) and
    terminal `completed`/`failed` states (`bash.ts:1040`, `2422`); the folded
    foreground result carries `foldReason` (`bash.ts:1950`). These are
    **generic Bash job facts** — nothing in them is browser-specific.
12. **Failure mapping.** `#buildResultText` (`bash.ts:897-917`) throws
    `ToolError` for cancellation ("Command aborted"), timeout ("Command timed
    out after N seconds") and non-zero exit (`nonZeroExitCause`). The exit
    code, signal and `cancelled` flag live on the internal `BashResult`
    (`packages/coding-agent/src/exec/bash-executor.ts:339-353`) and reach
    consumers **as formatted prose plus `isError`**, never as structured
    fields.
13. **GJC's own activity summarizer** projects only the bare program name for
    args and `exit=N, N lines, N bytes` for results
    (`summarizeBashToolActivity`, `bash.ts:523-557`). Even the runtime's own
    activity model treats Bash as "bash".
14. **Transcript persistence.** Tool calls (input + result) persist in the
    session JSONL; the app re-reads them through
    `GET /api/providers/sessions/:sessionId/messages`
    (`server/modules/providers/provider.routes.ts:216`). Live replay uses the in-memory
    run-event buffer (5 000 events, completed runs retained 5 min;
    `server/modules/websocket/services/chat-run-registry.service.ts:35-36`).
15. **Cancellation.** `session.abort()` kills in-flight Bash;
    `BashResult.cancelled` becomes the ToolError above. Worker-side
    `turn.abort` is time-bounded with child-signal fallback, and the app marks
    a run aborted only after the worker confirms
    (`server/GJC-LIVE-SPEC.md` §Process and terminal lifecycle; exactly one
    terminal browser event per run, synthesized if the worker dies).
16. **Policy boundary.** GJC "does not spawn or supervise any Aside process
    from GJC" (`docs/aside-integration.md` Option D); the Decision section
    keeps Aside external and opt-in. The runtime-side contract test is
    `packages/coding-agent/test/sdk-browser-aside-backend.test.ts`.

Live confirmation (POC, 2026-09-12): every browser action in app-driven runs
was a `bash` call of `aside repl '<code>'` (seven consecutive `bash` calls for
the checkbox task, after `skill` + `read` of SKILL.md), zero `browser` tool
calls (`docs/BROWSER-ASIDE-POC.md` §Validation).

## 3. Exact App-visible signals today

During a run the app receives, per tool call (`server/gjc-bun-sdk-events.ts`:
`SDK_EVENT_FIELDS_READ` at lines 23-34; mapping at lines 255-299; worker method
mapping `server/gjc-worker.ts:552-553`; method list
`server/gjc-worker-protocol.ts:29-43`):

- `tool_use { toolId, toolName, toolInput, displayText? }` — `displayText`
  mirrors the model's `intent` prose when present;
- `tool_result { toolId, content, isError, isFinal, toolUseResult? }` —
  `toolUseResult` is the runtime's structured `details`; updates (including a
  backgrounded job's `async.state`) arrive as `isFinal: false` frames keyed by
  the same `toolId`.

So for an Aside invocation the app sees: a `bash` tool call with an opaque
`command` string, generic process details, an authoritative `isError` at the
end, and — for backgrounded work — `async.state` transitions. The app also
knows, server-side, the **configured backend for the run**
(`server/gjc-browser-backend.ts` `GJC_BROWSER_BACKENDS = ['builtin','aside']`,
`applyGjcBrowserBackend` and `selectGjcAutomationTools` in
`server/gjc-bun-sdk-adapter.ts:258-288`), exposed to clients through
`GET/PUT /api/automation/browser-backend`. That is run-scoped configuration,
not a fact about any individual tool call.

What the sidebar consumes today: `AgentSidebarWork` reads the todo fold and
`status.activity.running`; its contract is explicit that "Nothing is inferred
from tool traffic, elapsed time or transcript prose". (The chat's
`deriveLiveActivity` does read tool traffic — `runningToolCalls` +
`describeToolSubject`, whose Bash subject is the first line of the command —
which is exactly the heuristic class the sidebar refuses; see
`src/components/chat/utils/toolActivity.ts:119-131`.)

## 4. Authority table

| Signal | Class | Basis |
| --- | --- | --- |
| Browser backend configured = Aside for this run | **A** | Server-resolved run option (`applyGjcBrowserBackend`), setting + probe; but session-scoped, says nothing about any single call |
| The session is running | **A** | Run registry / `chat_subscribed.isProcessing` (existing WORK input) |
| A Bash call is in flight | **D** — derived deterministically from the authoritative `tool_use` + final `tool_result` pair (absence of the final frame; `runningToolCalls`) | transport §3 |
| That Bash invocation is Aside browser work | **M** | No field, event or metadata exists; only the command string and the model's `intent` prose, both model-authored |
| Operation mode = repl | **M** | Characters inside `command` only |
| Operation mode = exec | **M** | Characters inside `command` only |
| Operation running (long/backgrounded) | **A** for "a Bash job is running" (`details.async.state:"running"` + `jobId`); **M** for "the Aside operation is running" | Generic job facts (§2.11) |
| Operation completed successfully | **A** at the tool level (`tool_execution_end.isError = false`) ; **M** as an Aside-activity fact | §2.12 |
| Operation failed | **A** at the tool level (`isError = true`); cause is prose (exit code / timeout / aborted strings) | §2.12 |
| Operation cancelled/aborted | **A** at the run level (`complete {aborted}`); at the tool level it surfaces as `isError` + "Command aborted" prose — distinguishable from failure only by text (**H**) | §2.12, §2.15 |
| User-visible label/description | **H** | `intent` prose or command text; both model-authored |
| Current URL/domain | **M** | Nobody knows it structurally; it may appear inside `aside repl` code or output as text |
| Aside exec session id | **M** | Exists only as `--session <id>` text the model typed |
| Work survives reconnect | **A** for finished calls (replay buffer + `seq`/`replayGeneration`); in-flight state is intentionally transient | `chat-run-registry.service.ts:53,287` |
| Work survives reload/restart | **A** for finished calls (transcript JSONL re-read); in-flight background jobs are worker-process-lifetime and die with it | §2.14; activity-model audit §Background work |

`intent` is classified **H**, not A: it is a model-authored free-text aid,
setting-gated, and absent in sub-sessions. "Works in one trace" does not
upgrade it.

## 5. Can current App-visible events render "● Browser · Aside"?

**No.** The four candidate facts are not equivalent and only the first two
exist:

1. *The session is running* — A (already rendered as the generic Working row).
2. *Bash is running* — **D** (derivable from the tool frames), but a Bash call
   is usually `npm test`; naming it "Browser" would be a lie.
3. *This Bash invocation is Aside browser work* — **missing** (§4 row 4). The
   only candidates are the command string and `intent`, both model-authored
   text — class H.
4. *It is `repl` or `exec`* — **missing** (§4 rows 5-6).

The configured-backend signal (A) cannot substitute: `browser.backend=aside`
holds for every run of the project, browser work or not.

## 6. Why Bash string parsing is rejected

An app-side `command.includes('aside repl')` check fails every requirement the
contract must survive, concretely:

- **Quoting and wrappers** — the runtime runs Bash through a login shell
  (`$SHELL -l -c`, `docs/BROWSER-ASIDE-POC.md` finding 4); the command may be
  `bash -lc '…'`, `nohup aside exec …`, piped through `tee`, or prefixed by
  env assignments (`BashToolInput.env` also exists).
- **Multiline** — `aside repl '<JavaScript>'` bodies are multiline programs
  (the POC traces show embedded `openTab("https://example.com")` code); a
  `startsWith` check never sees the invocation shape.
- **Variables and aliases** — a login shell can carry aliases; the command may
  be `ASIDE=~/.local/bin/aside; $ASIDE exec '…'` or use any absolute path the
  CLI probe itself considers valid (`asideCliCandidates`).
- **Prompt and skill changes** — the repl/exec policy lives in a versioned
  prompt fragment (`browser-aside.md`) and a **user-installed** skill, both
  outside this repository and both free to change; any parser encodes today's
  spelling of both.
- **CLI syntax changes** — the Aside CLI is external and versioned
  independently (1.26.810.1915 at POC time); subcommands and flags will move.
- **Truth, not just matching** — the deeper failure: the runtime never decides
  "this Bash call is browser work", so there is no authoritative fact for a
  parser to recover. A parser would have the app *invent* semantics the
  runtime does not own, with silent false positives (a README mentioning
  `aside`) and false negatives (any spelling variation) — precisely the class
  E behavior the activity-model audit bans for sidebar semantics.

Command-string inspection was used read-only during the POC to *understand*
behavior; it is not a UI source of truth.

## 7. Lifecycle gaps in the current signals

- No start semantic: nothing marks a Bash call as an Aside operation, so no
  lifecycle can even begin.
- No mode: repl/exec indistinguishable structurally.
- Terminal cause is prose: cancelled vs timed out vs non-zero exit reach the
  app as `isError` + formatted text (§2.12).
- Background jobs are Bash-generic: `async.state`/`jobId` exist and do
  transport (already inside `toolUseResult`), but say nothing about browsers.
- Worker restart: in-flight jobs are process-lifetime; runs settle with a
  synthesized terminal, so nothing can hang — but again only as generic Bash.
- Reload: finished calls reconstruct from the transcript; in-flight calls are
  absent by design (no stuck rows — good, and the same property must hold for
  any addition).

## 8. Recommended ownership boundary

Compared:

- **A. App infers from Bash** — rejected: heuristic by construction (§6).
- **B. GJC Bash tool emits generic process metadata** — this already exists
  (`BashToolDetails`: `terminalId`, `async`, `meta`, exit prose) and is
  insufficient *by construction*: at the execution boundary the tool has only
  the command string, so "more metadata" still cannot name the semantics
  without parsing. Deepening B is the same trap moved upstream.
- **C. GJC browser-backend routing emits structured activity** — the layer
  that already **owns the semantic contract**: it decides the tool surface and
  authors the routing prompt that makes Aside-repl-via-Bash happen at all
  (`browser-backend.ts` + `browser-aside.md`). Whatever "this is Aside browser
  work" means, this layer defined it.
- **D. A dedicated Aside integration layer emits structured activity** — would
  require GJC to spawn/supervise Aside (a wrapper tool or exec supervisor).
  This reverses the published boundary ("does not spawn or supervise any Aside
  process from GJC", `docs/aside-integration.md` Option D) and the app-side
  rule that the app adds no Aside tool/prompt/skill. Rejected.
- **E. The existing tool-call lifecycle as the carrier** — the runtime's
  per-call structured channel (`tool_execution_start/update/end` + per-tool
  `details`) is exactly the abstraction that already carries comparable
  semantics: `TodoWriteToolDetails.phases` powers WORK's todo fold;
  `TaskToolDetails {subagents}` powers delegation history; `BashToolDetails`
  already carries `terminalId`/`async`. It is persisted, replayed, sequenced
  and session-scoped for free.

**Recommendation: C owns the semantic, E carries it.** The browser-backend
routing contract (the prompt fragment plus the Bash tool schema it governs)
makes the model *declare* the activity as structured data on the tool call,
and the ordinary tool-call lifecycle transports that declaration. Neither the
app nor the Bash executor ever classifies anything; the declaration is
validated for shape and carried verbatim.

Authority honesty: a model-declared field is not runtime-*verified* — the
runtime validates the enum, not the truth of the claim. That is the same
authority level as the routing itself (Aside-via-Bash only happens because the
prompt says so), and it is a level above any string parsing, which reads the
same model's spelling *after the fact* through shell syntax. The only stronger
owner is D, which is rejected as a policy reversal.

## 9. Minimal contract

One addition, no new event kind, no new bus, no new store:

```ts
// GJC: optional field on the Bash tool input, used only under the
// browser-backend=aside routing contract, mirrored into the result details.
type BashActivityDeclaration =
  | { kind: "browser"; provider: "aside"; mode: "repl" | "exec" };
```

- **Placement**: `BashToolInput.activity?: BashActivityDeclaration`
  (`bash.ts` schema, zod-validated enum shape; malformed values are ignored,
  never fatal). The prompt fragment gains one line requiring the declaration
  on every Aside invocation. `BashToolDetails.activity?` mirrors it so results
  are self-describing (input alone would already persist, but details is the
  convention every other consumer folds from).
- **Fields kept deliberately**: `kind` + `provider` + `mode`. Nothing else.
  - No `url`, no `domain`: the emitting layer does not know either
    structurally — the URL lives inside the model's JavaScript/prompt text.
  - No `label`: the row label derives from `{kind, provider, mode}` in the
    app; a free-text label would be `intent` again.
  - No `sessionId` for `aside exec --session`: it is text the model typed;
    if a future product need appears, add `ref?: string` then.
  - `provider` is kept (rather than assuming "aside" from the run config) so
    the shape is provider-neutral without a later schema change. See §12 for
    why the Built-in browser still must not ride this contract.
- **Transport: zero changes.** The app already receives `toolInput` on
  `tool_use` and `toolUseResult` on `tool_result` (`gjc-bun-sdk-events.ts`
  §3); the worker protocol already carries both as `tool.started` /
  `tool.completed`. No new `GJC_WORKER_EVENT_METHODS` entry, no
  `SDK_EVENT_FIELDS_READ` change (`args` and the details passthrough already
  flow verbatim).
- **Lifecycle**: the existing tool-call lifecycle *is* the activity lifecycle
  (§10).

## 10. Replay / reconnect / cancellation behavior

| Transition | What happens | Guarantee relied on |
| --- | --- | --- |
| Start | `tool_use` with `toolInput.activity` → WORK row appears | existing `tool.started` ordering |
| Still running, backgrounded | `tool_result {isFinal:false, toolUseResult:{async:{state:"running", jobId}}}` → row stays, keyed by `toolId` | `bash.ts` job progress frames (§2.11) |
| Normal completion | final `tool_result {isError:false}` → row ends (not kept visible) | §2 |
| Command failure | final `tool_result {isError:true}` → row ends | §2.12 |
| Run abort | Bash is killed; the run's single `complete {aborted}` arrives; `activity.running` goes false → row ends even if a frame was missed | exactly-one terminal event per run (`GJC-LIVE-SPEC.md` §Process and terminal lifecycle) |
| Worker death | server synthesizes one error + one failed completion → row ends | same |
| App disconnect/reconnect | missed frames replay through `seq`/`replayGeneration` (5 000-event buffer, 5 min retention) | `chat-run-registry.service.ts:35-36,53,287` |
| Reload | message window re-fetched from the transcript JSONL: finished declared calls reconstruct; an in-flight call simply has no final frame, so no stale "running" row can exist | transcript is the durable record; no server chat rows |
| Worker restart | in-flight jobs die with the process; runs settle → row ends | jobs are process-lifetime |

No stuck-forever state: every start is bounded by a tool terminal or by the
run's exactly-once terminal, and absence-after-reload is the designed outcome
for in-flight work — identical to how the todo fold behaves.

Ids and sequencing: **none new.** `toolCallId` is the operation id (already
unique, already pairs frames, already persisted); session scoping, `seq` and
replay generation already exist. No snapshot protocol, no second durable
browser database — the transcript already is the record.

## 11. repl vs exec, and WORK presentation

The distinction is structurally real once declared, and worth showing because
the two modes differ in product meaning, not just mechanics:

- `repl` — deterministic Playwright execution **by this session**: the model
  wrote JavaScript, the session's own work continues immediately after.
- `exec` — a **separate agentic execution**: another model instance with
  runtime judgment, potentially MFA/credential interaction in the user's real
  profile, resumable via `--session`, consuming its own Aside usage
  ("work worth a second model", per the routing fragment). The user cares that
  something metered and privileged is running, which "Working in the browser"
  alone would hide.

Recommended compact terminology (implementation jargon stays out):

```text
WORK

● <current in_progress todo>
○ <next pending todo>

● Browser · Aside        ← repl
● Aside agent            ← exec
```

Composition rules:

- Activity rows appear whenever a declared activity is in flight for the
  visible session — **with or without TODOs** (an Aside-heavy session often
  has no list; that is exactly when the row earns its place).
- TODOs are never replaced or reordered; activity rows sit beneath them as
  peer rows in the same section.
- Completed/failed activity is **not** kept visible: WORK is "what is
  happening now"; history is the transcript (a Review section is a separate,
  explicitly undecided product).
- Multiple simultaneous operations are possible (parallel tool calls,
  backgrounded jobs). Render one row per in-flight declared activity, capped
  at two with a `+N` overflow marker, to keep the lane compact.
- The status line under the row is static ("Working in the browser") — no
  URL, no progress inference, no elapsed-time claims.

## ACTION REQUIRED boundary

Unchanged and explicitly not extended: Aside completed/failed/cancelled or
waiting-internally never becomes Action Required. Two real cases are worth
naming:

- **The command itself needs permission.** Bash is a gated tool
  (`GJC-LIVE-SPEC.md` §Tool permissions; the POC runs approved `aside repl`
  through the app's permission card). That already arrives through the
  authoritative `sdk-permission:` pipe and renders as ACTION REQUIRED — no
  browser-activity state involved, and that is correct.
- **Aside waits on the user inside the CLI/window** (approval/notification
  waits are an `aside exec` use case). GJC sees only a long-running Bash call;
  it cannot know. Surfacing that would require an authoritative user-input
  request flowing from Aside through GJC's ask/permission bridge — a separate
  contract and product decision, out of scope here. Until then the honest
  display is "running", never "action required".

## 12. Built-in browser: kept separate

The Built-in WebView browser is already structurally visible: it runs as the
first-party `browser` tool, so `toolName === 'browser'` **is** the semantic —
no declaration, parsing or new contract needed for a future row (its card
already reads `input.action`/`input.url`, `toolConfigs.ts` `browser` entry).
Folding it into this contract would buy nothing and cost a second producer.

The one carried-over neutrality is the field *shape* (`kind`/`provider`): if a
future provider ever routes through Bash the same way, it reuses the schema
without a breaking change. `provider: "builtin"` is deliberately **not**
defined by this PR sequence.

## 13. Agent/subagent boundary

`aside exec` being agentic does **not** make it a delegation. The App's
delegation contract (`server/gjc-delegation-executor.ts`, receipts
`gajae-app.delegation.v1`) creates children via `createAgentSession` with
`childSessionId`, turn-scoped lifetime, limits and receipts in the owner
transcript. An Aside exec is an external CLI subprocess whose entire GJC
lifecycle is one Bash tool call: no child session, no receipt, no cancellation
contract beyond process kill, no `resultText`. It must not reuse
`delegation.updated`, receipts, agent rows or child counts; the two lifecycles
share nothing but the word "agent". (Conversely, the live delegation-lifecycle
gap in `agent-sidebar-activity-model.md` §Missing Capabilities is unchanged by
this document.)

## 14. Non-goals

- No Bash command parsing, matching or classification anywhere.
- No App-side Aside tool, prompt, skill, MCP server or routing policy.
- No change to `browser.backend`, the routing fragment's policy content, the
  `aside` skill, or the no-fallback `aside_unavailable` behavior.
- No Built-in WebView changes and no builtin activity rows.
- No new worker-protocol method, WebSocket channel, store or table.
- No agent/subagent lifecycle, delegation receipts, IRC.
- No ACTION REQUIRED broadening; no Review/recent-activity section.
- No `url`, `label`, exec-session-id or any field the emitter cannot know
  structurally.

## 15. Recommended implementation sequence

Not implemented here. Three small PRs; A lives in the GJC repository:

- **PR A — GJC: declared Bash activity.** Optional `activity` input field
  (zod shape) + one routing-fragment line requiring it on Aside invocations +
  mirror into `BashToolDetails.activity` + tests
  (`sdk-browser-aside-backend.test.ts` extension; bash schema/details tests).
  Touches only the browser-backend routing contract it already owns.
- **PR B — App: pin, transport proof, fold.** Bump `@gajae-code/coding-agent`
  to the release carrying A (this repo's SDK lifecycle workflow: reapply the
  canonical patch through a clean install and regenerate tracked runtime
  hashes via `npm run fill:runtime-manifest -- --update`, per AGENTS.md), then
  a pure fold helper over the message window — latest declared activity per
  in-flight `toolId`, terminal on final result — plus unit tests proving:
  declaration present/absent, backgrounded `async.state` keeps the row, abort
  and reload drop it, and undeclared `bash` never yields a row. No transport
  code changes are expected; `gjc-bun-sdk-events` already passes `args` and
  `toolUseResult` verbatim.
- **PR C — App: WORK renders the compact rows.** `AgentSidebarWork` gains the
  activity rows beneath the TODO list with the §11 labels and cap, i18n keys
  in all locales, DOM tests for with-TODOs / without-TODOs / multi-row /
  mobile.

A and B cannot merge with each other (different repositories, and the app must
pin a released SDK). B and C *could* be one PR since B ships nothing
user-visible; keeping them separate isolates the SDK pin bump — which carries
this repo's heaviest verification surface — from a small UI review. If the
team prefers one App PR, B+C is safe: B without C is inert.

AUDIT RESULT: MINIMAL_CONTRACT_REQUIRED
