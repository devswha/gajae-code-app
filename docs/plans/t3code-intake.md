# T3 Code intake assessment

Source: [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) @ `main`, read on
2026-08-31. Reference clone kept outside the repo at `~/workspace/.t3code-ref`
(`git clone --depth 1`, 320 MB) — it is not vendored and must never be committed.

Scope: is a fork worth it, and which features are worth taking?

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

## Intake rules that apply

Per [UPSTREAM.md](../UPSTREAM.md): anything ported keeps the MIT copyright notice
for T3 Tools Inc., lands on a dedicated `intake/` branch, passes
`npm run check:identity`, and carries focused tests for every changed behavior.
Where we port a *design* rather than bytes, cite the source file in the commit
body rather than adding a licence header.
