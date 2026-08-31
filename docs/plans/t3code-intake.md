# T3 Code intake assessment

Source: [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) @ `main`, read on
2026-08-31. Reference clone kept outside the repo at `~/workspace/.t3code-ref`
(`git clone --depth 1`, 320 MB) — it is not vendored and must never be committed.

Scope: is a fork worth it, which features are worth taking, what the bundled
GJC SDK already gives us for free, and how the two chat surfaces compare.

> The single most important thing found during this review has nothing to do
> with t3code. See [The allowlist is not the boundary](#the-allowlist-is-not-the-boundary)
> — `server/gjc-agent-tools.ts` documents `goal` as withheld, and it is on in
> every browser session today.

## Verdict

**Do not fork. Do concept intake of four features under [UPSTREAM.md](../UPSTREAM.md).**

A fork is not a merge here — it is a rewrite. The two projects solve the same
problem (agent-harness control surface, web + desktop, multiple provider CLIs)
and share almost no substrate.

| | gajae-code-app | t3code |
| --- | --- | --- |
| License | AGPL-3.0-or-later | MIT (© 2026 T3 Tools Inc.) |
| Server | Express + hand-rolled WS + better-sqlite3 | Effect RPC over one `/ws`, event-sourced engine |
| Client state | TanStack Query + Zustand + 5 contexts | Effect Atom in `packages/client-runtime` |
| Repo shape | single npm package + `server/` | pnpm workspace, `apps/*` + `packages/*` |
| Build | Vite 7 / npm | Vite+ (`vp`), pnpm 11, Node ^24.13.1 |
| Desktop | Tauri 2 (Rust) | Electron |
| Mobile | none | React Native app (iOS + Android, shipped) |
| Native | `native/gajae-core` (Rust) | `native/libghostty-vt` (Zig/C), `resource-monitor` |

Every server package they ship — including the "self-contained" looking
`packages/tailscale` and `packages/ssh` — declares `effect` as a runtime
dependency and is written in `Effect.gen`/`Layer` style. There is no file in
that repo we can drop into `server/` unchanged. Copying means porting.

Two further facts settle it:

- **License direction is one-way.** MIT into AGPL is fine (keep their copyright
  notice on any ported file). AGPL into MIT is not, so nothing flows back and
  we would carry a divergent fork forever.
- **They are not taking contributions.** README: "We are (mostly) not accepting
  contributions yet. Big features will not be." A fork gets no upstream.

So: read their design, port the ideas, cite the source. That is exactly what
`docs/UPSTREAM.md` already prescribes.

## Ranked candidates

### 1. Per-turn checkpointing — take it, highest value

This is the single best thing in that repo and the one gap we can prove we have.
`server/gjc-agent-tools.ts` already withholds two runtime tools for this exact
reason:

```
checkpoint: 'Manipulates session state the app also owns; needs the two models reconciled first.',
rewind:     'Same session-state overlap as checkpoint.',
```

We ship job worktrees and a job-level `git diff`, but nothing brackets a single
turn, so "show me only what this turn changed" and "undo this turn" do not
exist.

Their capture is plain git plumbing against a throwaway index — it never
touches the user's index, stash, or HEAD
(`apps/server/src/vcs/GitVcsDriver.ts:712`):

```
GIT_INDEX_FILE=<gitCommonDir>/t3-checkpoint-index-<uuid>
git read-tree HEAD              # only when HEAD exists
git add -A -- .
git write-tree                  # -> treeOid
git commit-tree <treeOid> -m "t3 checkpoint ref=<ref>"
git update-ref <hidden ref> <commitOid>
```

Restore is `git restore --source <oid> --worktree --staged -- .`, then
`git clean -fd -- .`, then `git reset --quiet -- .`. Diff is
`git diff --patch --no-color --no-ext-diff --no-textconv <from>^{commit} <to>^{commit}`
with an output byte cap.

Port target: a `CheckpointOps` surface next to `server/services/gjc-job-git.service.ts`,
driven from the turn lifecycle the worker client already tracks
(`turn.completed` in `server/gjc-worker-protocol.ts`). ~50 lines of plain Node
plus ref GC. Their `apps/server/src/vcs/testing/VcsDriverContractHarness.ts`
(169 lines) is worth reading as a test shape.

Do **not** port their `CheckpointReactor` / event-sourced engine to get this.
The git plumbing is the valuable part; the orchestration around it is Effect.

Second half of the feature — reverting the *provider conversation* alongside the
workspace — is where the withheld `rewind` tool comes back in. Sequence
workspace-revert first, conversation-revert second.

**Correction from the SDK audit below.** The withheld `checkpoint` tool does
*not* do what its own description implies. Its entire state is three fields —
message count, session-tree entry id, timestamp
(`node_modules/@gajae-code/coding-agent/src/tools/checkpoint.ts:11-18`) — and
`execute()` never touches git, stash, or the filesystem
(`.../tools/checkpoint.ts:49-88`). `rewind` truncates the model conversation to
the captured count, branches the SDK transcript, and appends a hidden report
(`.../session/agent-session.ts:16479-16511`). **Workspace edits stay on disk.**

So the two mechanisms are not alternatives, they are the two halves:

| | SDK `checkpoint`/`rewind` | t3code git refs |
| --- | --- | --- |
| Captures | conversation tree + message count | tracked tree, index, untracked files |
| Restores | model context, transcript branch | working tree |
| Costs | nothing, in-process | one hidden ref per turn |

A "Restore this turn" button needs **both**, and they cannot be made atomic.
Design for two outcomes reported separately, not one transaction. A cheaper
first product is "Condense investigation" — SDK rewind alone, no git — which is
honest about only reclaiming context.

### 2. WebSocket ticket auth — take it, cheap

We build `wss://<host>/ws` same-origin (`src/contexts/WebSocketContext.tsx:101`)
and lean on the session cookie. That is fine while we are loopback-only and
becomes wrong the moment anything below is on the table.

Theirs: client presents its bearer/DPoP credential to
`POST /api/auth/websocket-ticket` over HTTP headers, gets a `kind: "websocket"`
ticket with a 5-minute TTL, and appends only that as `?wsTicket=`. Never a
long-lived token in a URL. Then — the part that actually matters — **holding the
socket is not authorization to call everything on it**: each RPC method maps to
a required scope and is checked per call.

Our `/ws` message router has no per-method authorization at all. Worth fixing
independently of remote access.

### 3. Remote access model — take the design, not the code

`docs/SELF-HOST.md` currently says "keep the service on loopback, prefer a
trusted VPN or an SSH tunnel" — i.e. we punt remote access to the operator.
Their `docs/internals/remote.md` is the best-written part of the repo and gives
us a model we can adopt without their transport:

- `ExecutionEnvironment` = one running server, stable `environmentId` persisted
  at `<stateDir>/environment-id`.
- `AdvertisedEndpoint` = server-authored candidate (http+ws base pair,
  reachability hint: loopback / LAN / private / public / tunnel, hosted-HTTPS
  compatibility flag). Clients treat these as *hints*; the connection attempt
  decides.
- Endpoint selection with **no unconditional loopback fallback**: saved override
  → `isDefault` → first non-loopback → first hosted-HTTPS-compatible → nothing.
- Pairing URL puts the token in the **hash**, not the query, so it never reaches
  the hosted origin; strip it from history after exchange.
- Tailscale is an *endpoint provider*, not a connection kind — a tailnet URL
  pairs through the ordinary bearer path.

`packages/tailscale/src/tailscale.ts` is 404 lines wrapping `tailscale serve`
acquire/release around the actual listening port. Small enough to reimplement,
Effect-coupled enough that we would reimplement rather than copy.

Their relay (`infra/relay`, Cloudflare Worker + managed tunnel hostnames) is a
hosted service. Out of scope.

### 4. `DrainableWorker` — take the idea, 70 lines

`packages/shared/src/DrainableWorker.ts` pairs a transactional queue with a
transactional count of outstanding items: `enqueue` atomically offers and
increments, processing always decrements, and `drain` retries until the count
hits zero. A test awaits "queue empty **and** the current item finished" instead
of sleeping.

We have several async projection/reactor paths with the same shape
(`server/modules/websocket/services/gjc-job-projection.service.ts`,
`server/modules/notifications/services/gjc-terminal-notification-adapter.service.ts`).
Their version is built on Effect `TxQueue`/`TxRef`; the pattern is a promise and
a counter and needs no Effect.

Also worth stealing from the same layer: **durable command receipts** so a
retried command is idempotent, and a single worker fiber so command processing
is totally ordered.

## Not worth taking

- **Effect migration.** Their whole architecture presumes it. Adopting Effect to
  get one feature is the tail wagging the dog.
- **Event-sourced orchestration engine.** Real benefits (read model cannot
  durably disagree with the log) but it is a ground-up rewrite of everything in
  `server/modules/`, and we already have a working SQLite projection path.
- **Electron desktop shell.** We are on Tauri 2 deliberately; going back is a
  regression.
- **React Native mobile app.** Separate product, separate maintenance surface.
  Revisit only after remote access exists — a mobile client with nothing to
  connect to is pointless.
- **`native/libghostty-vt`.** Only if terminal rendering becomes a measured pain
  point. We already carry a Rust native core; adding a Zig/C VT parser is a
  build-toolchain cost with no current complaint behind it.
- **`infra/relay`, `apps/marketing`, `oxlint-plugin-t3code`, Vite+/`vp`.** Their
  infrastructure, not ours.

## Sequencing

1. **WebSocket per-method authorization** — standalone, no dependencies, closes
   a real hole today.
2. **Per-turn checkpoint capture + turn diff** — the feature users feel.
3. **Turn revert (workspace)**, then un-withhold `checkpoint`/`rewind` in
   `server/gjc-agent-tools.ts` once the two models are reconciled.
4. **WebSocket ticket auth + advertised endpoints + pairing** — only after 1,
   and only if remote access is actually wanted.

`DrainableWorker` can land opportunistically alongside any of these.

---

# GJC SDK: what we already own and do not ship

t3code had to build five provider drivers, a checkpoint system, and an
orchestration engine because the CLIs they drive give them nothing. We bundle
`@gajae-code/coding-agent` 0.15.0, which ships most of that as library code.
We surface a fraction of it.

## The allowlist is not the boundary

**This is a defect, not a roadmap item.**

`server/gjc-agent-tools.ts` reads as a closed allowlist: 14 tools explicitly on,
11 explicitly off with a written reason. The SDK does not treat it that way.
`createTools` takes `toolNames` as a *seed* and appends to it based on settings
that all default to `true`
(`node_modules/@gajae-code/coding-agent/src/tools/index.ts:578-620`,
`.../config/settings-schema.ts:2729-3362`):

| Setting | Default | Effect on our session |
| --- | --- | --- |
| `goal.enabled` | `true` | adds `goal` + goal-mode tools |
| `astEdit.enabled` | `true` | adds `ast_edit` because we send `edit` |
| `recipe.enabled` | `true` | adds `recipe` because we send `bash` |
| `astGrep.enabled` | `true` | adds `ast_grep` - harmless, we enable it anyway |

Our adapter passes `toolNames: [...config.toolNames, 'ask']` and nothing else
(`server/gjc-bun-sdk-adapter.ts:432`), so:

- **`goal` is live in every browser session** despite `GJC_AGENT_TOOLS_WITHHELD`
  saying it is off because "Goal-mode artifacts accumulate as files the app
  cannot display." The file documents a decision the runtime does not honour.
- `ast_edit` and `recipe` are live and were never decided either way.

Two further leaks in the same direction: project hooks and MCP/plugin tools are
discovered and imported into the session with no app-side trust decision
(`.../sdk/session.ts:2941-2967`, `.../sdk/session.ts:3715-3732`).

The file's header comment is also factually wrong on two counts: the SDK ships
**37** platform-eligible builtins on Apple Silicon, not 35
(`.../tools/descriptors.ts:414-525`), and 12 of them are neither enabled nor
withheld - nobody has decided.

### Undecided tools

`ast_edit`*, `recipe`*, `render_mermaid`, `debug`, `bisect`, `eval`, `python`,
`calc`, `github`, `search_tool_bm25`, `skill_discovery`, `move_session`.
`*` = already live via SDK defaults.

Three of these deserve a *refusal*, not neglect: `bisect` promises
`git reset --hard` cleanup of tracked edits, `move_session` permanently
repoints the session cwd against our stable project binding, and
`search_tool_bm25` activates arbitrary tools at runtime, which is incoherent
with any allowlist.

### The fix

`createAgentSession` accepts `settings?: Settings`
(`.../sdk/session.ts:581`). Construct one with the four flags forced to match
declared policy, and replace the drift test with a **partition** test: every
key in `BUILTIN_TOOLS` must be exactly one of enabled or withheld-with-reason,
and the assertion must run against the *created session's* active tool names,
not against `GJC_AGENT_TOOL_NAMES` membership.

### Fixed in `e2ef73d`

`applyGjcToolSettingsPolicy(settings)` now runs on the per-run cwd clone in
`server/gjc-bun-sdk-adapter.ts` and forces `goal.enabled` and `astEdit.enabled`
off. `recipe` was promoted into the explicit enabled list instead: it resolves a
detected runner task, delegates to `BashTool`, and returns `BashToolDetails`,
which the generic tool card already renders - so it is a real capability rather
than an accident, and listing it stops `recipe.enabled` from being one.

`ast_edit` is withheld because it dry-runs and then queues the hidden `resolve`
tool to commit; `resolve` is not requestable through `toolNames`, so a browser
session stages previews it can never apply.

All 12 undecided names now carry a written decision, the header states the
partition invariant instead of a count that rots, and
`server/gjc-agent-tools.bun.test.ts` asserts that every `BUILTIN_TOOLS` key
lands in exactly one list. Verified by removing `calc` from both lists: the
test fails with `calc has no single tool-policy decision`.

One briefing correction from the fix: the adapter was already calling
`globalSettings.cloneForCwd(config.cwd)`, so per-session isolation existed and
only the policy application was missing.

## Capability we are sitting on

Ranked by value per unit of effort. Every one of these is library code we
already ship and do not expose.

**1. Goal mode.** Durable objective with token and wall-clock accounting,
pause/resume/complete/drop, and continuation
(`.../goals/runtime.ts:20-45`). Already auto-enabled, so the work is entirely
projection: `gjc-bun-sdk-events.ts` has no `goal_updated` case
(`server/gjc-bun-sdk-events.ts:189-317`), so the browser sees generic tool rows
instead of goal state. Attaches to the sidebar session row and the session
action menu.

**2. Structured GitHub operations (`github`).** Repos, PRs, search, checkout,
push, Actions as typed operations instead of the model assembling `gh` strings
(`.../tools/tool-catalog.generated.ts:795-938`). Start read-only plus PR
creation; route mutations through the confirmation pattern the commit composer
already uses.

**3. DAP debugging (`debug`).** Real launch/attach, breakpoints, stepping,
stack and variable inspection, expression evaluation
(`.../tools/debug.ts:32-103`, `.../dap/session.ts:1-110`). Unreachable for one
reason only: we never request the tool. Attaches to CodeMirror as a debug
panel.

**4. Task/subagent orchestration.** Parallel role agents with progress,
artifacts, worktree isolation and receipts (`.../task/index.ts:1-93`). Highest
ceiling, highest cost - needs spend admission and reconciliation between the
SDK's `AsyncJobManager` and our durable job authority. Do not ship two `/jobs`
models.

**5. Memory.** `hindsight/` is a remote long-term memory bank that recalls
before the first prompt and retains on lifecycle boundaries, with curated
"mental models" spliced into developer instructions
(`.../hindsight/backend.ts:41-119`). `memories/` is the local alternative, a
background two-phase consolidation over past rollouts
(`.../memories/index.ts:106-161`). Both are off by default
(`memory.backend=off`, `.../config/settings-schema.ts:2065-2068`). **No other
harness in this category has this**, t3code included.

Second wave: `render_mermaid`, then *one* consolidated eval surface - do not
expose `eval` and `python` as competing user concepts.

## Leave alone

`modes/`, `vim/`, SDK `stt/`, the star reminder and the TUI debug menu are
terminal-owned and duplicate surfaces React already owns. `harness-control-plane/`
and the outward `coordinator/` MCP server would create a second lifecycle
authority beside our worker supervisor and job authority. The standalone
`commit/` pipeline duplicates our commit composer. `cron`/`monitor`/`job` stay
off until there is a durable job screen with cancellation.

## Stale contract

`server/GJC-LIVE-SPEC.md:7-25` still describes the retired CLI path
(`gjc -p --mode json` with the SDK as optional loopback). Production launches
Bun -> `gjc-bun-worker` -> `createGjcBunSdkAdapter` -> `createAgentSession`
(`server/gjc-worker-client.ts:582-605`, `server/gjc-bun-worker.ts:1-11`). Rewrite
it before any capability plan cites it.

---

# Chat UI: theirs vs ours

Their advantage is not styling. It is an explicit **turn model** - turn ids,
lifecycle, activity records, checkpoints, turn diffs - which lets them fold
settled turns, summarize per-turn changes, offer revert, and navigate long
threads. Our `NormalizedMessage` has detailed kinds and live sequence numbers
but **no turn identity** (`src/stores/useSessionStore.ts:44-100`).

So the apparent UI gap is a data-model gap. The fix is additive turn metadata
over the existing transcript + Query pipeline, never a second message authority.

## Where we are already better - do not "upgrade" into a regression

- **Tool cards.** Ours are runtime-specific and understand real fields - `path`,
  `edits`, todo operations, browser actions
  (`src/components/chat/tools/configs/toolConfigs.ts:164-188,300-438`). Theirs
  is a generic work log showing command/detail/MCP JSON/changed paths
  (`.t3code-ref/apps/web/src/components/chat/MessagesTimeline.tsx:2169-2237`).
  Swapping ours for theirs loses output fidelity and makes failures harder to
  diagnose.
- **Run control.** We have an ordered persistent queue *and* a separate
  steer-now path during a live turn
  (`src/components/chat/view/ChatComposer.tsx:254-292`). Theirs shows only stop
  while running (`.../ComposerPrimaryActions.tsx:273-280`).
- **Voice.** We have web/Tauri transcription today
  (`src/components/chat/view/ChatComposer.tsx:225-242`). They have none on web
  or desktop - iOS only (`.t3code-ref/docs/internals/voice-input.md:3-6`).
- **Question panel.** Ours is more explicit about "Other", skip, back, progress
  and keyboard selection
  (`src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx:70-363`).
- **Realtime pipeline.** Query windows + realtime tails reconciled by replay
  cursor is the correct architecture for a disk-backed provider transcript.
  Their Effect Atom projection is coherent in their system and would be a
  second authority in ours.

## Ranked ports

| # | Change | Value/effort | Server change |
| --- | --- | --- | --- |
| 1 | Thread-scoped durable drafts | 5 / 2 | no |
| 2 | Responsive composer overflow menu | 3 / 1 | no |
| 3 | Explicit turn rows + settled-turn fold | 5 / 3 | **yes** |
| 4 | Per-turn changed-files card + revert | 5 / 4 | **yes** |
| 5 | Loaded-window turn minimap | 3 / 2 | no |

**1. Thread-scoped drafts.** We key unsent text by *project*
(`draft_input_${projectId}`,
`src/components/chat/hooks/useChatComposerState.ts:240-245,1269-1290`), so two
threads in one project share and overwrite one draft. They scope to thread
identity and report quota loss instead of silently discarding
(`.t3code-ref/apps/web/src/promptStashStore.ts:139-183`). Text and model
selection only - do not serialize `File` objects.

**2. Composer overflow.** Our tools row is `overflow-hidden` while holding
attach, voice, two model controls, skills and context usage
(`src/components/chat/view/ChatComposer.tsx:406-448`) - at narrow widths
controls simply vanish. They measure and demote secondary controls into a menu.
Buildable with our owned `ActionMenu`; no new dependency.

**3. Settled-turn folding.** After a turn settles they hide intermediate
commentary behind "Worked for ..." / "You stopped after ..." and leave the final
answer visible (`.../MessagesTimeline.logic.ts:480-580`). We only fold
consecutive calls of the same tool (`src/components/chat/utils/toolGrouping.ts:33-83`).
**Do not infer turns from user-message boundaries** - that misclassifies
steering, interruption, multi-segment answers and page splits. Add `turnId` +
terminal state to the normalized envelope first.

**4. Per-turn changed-files card.** The visible endpoint of the checkpoint work
above: a file tree of what the turn changed, with revert anchored to the
initiating user message (`.../ChangedFilesTree.tsx:25-174`). Our diff is
currently per edit-tool invocation
(`src/components/chat/tools/components/ToolDiffViewer.tsx:19-91`). **Add**
alongside the tool cards, do not replace them.

**5. Minimap.** Hover/keyboard navigation previewing each user turn and its
final answer (`.../MessagesTimeline.tsx:673-918`). Reimplement over our loaded
Query window and DOM scroll container - do not import LegendList to copy it.

## Blocked below the UI

Their composer takes arbitrary files, video, terminal selections, element
picks, preview annotations and review comments. Ours accepts five images at
5 MiB (`src/components/chat/hooks/useChatComposerState.ts:677-683`) and the GJC
adapter ultimately hands `session.prompt` a **string**
(`server/gjc-bun-sdk-adapter.ts:299-300`). Attachment semantics have to exist
in the provider contract before any of that chrome is worth building.

## Traps

- **Memoization.** Their `memo`/stable-row machinery exists to satisfy
  LegendList row boundaries. Our React Compiler owns memoization by policy;
  copying it is noise.
- **Raw HTML.** They can turn on `rehypeRaw` plus a sanitizer
  (`.t3code-ref/apps/web/src/components/ChatMarkdown.tsx:65-70`). We have
  neither, deliberately. Port only AST-safe markdown affordances.
- **Primitives.** Do not add Radix or Base UI to copy their menus. `ActionMenu`,
  `Dialog`, `Collapsible`, `Button`, `Tooltip`, `ScrollArea` already exist in
  `src/shared/view/ui/`.
- **State.** Do not port Effect Atom thread projections. Add fields and
  selectors to the store we have.

---

## Revised sequencing

0. **Fix the tool boundary.** Decide `goal`, force SDK settings to match the
   declared policy, convert the drift test to a partition test. Everything
   below assumes the capability boundary means something.
1. **WebSocket per-method authorization** - unrelated hole, still open.
2. **Thread-scoped drafts + composer overflow** - two small client wins that
   need no protocol change.
3. **`goal_updated` projection + goals UI** - cheapest real feature, because
   the runtime half already runs.
4. **Turn metadata in the normalized envelope** - unlocks folding, the minimap,
   and the turn diff card.
5. **Git-ref checkpoints + per-turn changed-files card + revert** - the
   headline feature, on top of 4.
6. **SDK `rewind` as "Condense investigation"** - separate action, separate
   outcome, never sold as "restore".

## Intake rules that apply

Per [UPSTREAM.md](../UPSTREAM.md): anything ported keeps the MIT copyright notice
for T3 Tools Inc., lands on a dedicated `intake/` branch, passes
`npm run check:identity`, and carries focused tests for every changed behavior.
Where we port a *design* rather than bytes, cite the source file in the commit
body rather than adding a licence header.
