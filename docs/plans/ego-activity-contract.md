# ego browser activity contract

Status: research/design only — no production code changed (2026-09-16).
Question answered: **can Gajae Code App render what the ego lite browser is
doing while a session drives it, and what would it cost?**

Verdict: **yes, and unlike Aside it can be rendered from an authoritative
source.** ego lite exposes its own live space/tab/page state to any process
through the `ego-browser` CLI, cheaply (0.12-0.17 s per read) and without
disturbing a script that is mid-action in the same space. The app does not have
to parse Bash commands, and it does not have to trust model prose.

This is the ego counterpart of `docs/plans/aside-activity-contract.md`, whose
conclusion was the opposite (`MINIMAL_CONTRACT_REQUIRED`: nothing authoritative
exists for Aside, so the runtime must be changed first). The difference is not
the app and not GJC — it is that ego lite has a queryable runtime and Aside
does not.

## 1. Evidence

All numbers are live probes on this machine, 2026-09-16, ego-browser
**0.5.0.32** (chromium 152.0.7977.54, node v24.18.1), macOS, CLI resolved at
`~/.local/bin/ego-browser` (the path `probeEgoBrowserCli` already pins).

| Probe | Result | Wall time |
| --- | --- | --- |
| `listTaskSpaces()` from a cold CLI process | `{createdBy, id, name, taskId, ownership, profileId, profileName, recentTabTitles[]}` per space | 0.120 s |
| `taskSpace(id)` + `tabs()` + `page.info()` from an **independent** process | `{label, targetId, title, url, active, openedBy}` per tab; `{url, title, w, h, sx, sy, pw, ph}` | 0.119 s |
| `page.screenshot({path})` from an independent observer | PNG 1512×828, 18 689 bytes | 0.146 s |
| 3 observer rounds while another script held the space in `waitForTimeout(9000)` | every round returned state + screenshot, no error, no ownership change | 0.171-0.173 s each |
| The held script afterwards | completed its remaining `goto` and `finish({keep: []})`; the space then disappeared from `listTaskSpaces()` | — |
| Script stdout during a long round (`console.log` at t≈0, read at t=3 s) | **empty**; all lines appeared only when the CLI process exited | — |

Two of those rows decide the design:

- **Concurrent observation is safe.** A second CLI process reading a live
  agent-owned space neither blocks nor breaks the agent's own round.
- **The CLI does not stream.** Everything the model prints inside its script is
  invisible until that round's process exits, so a "print progress markers"
  protocol cannot produce live progress at all — it only re-decorates the tool
  result the app already gets.

CLI surface (`ego-browser --help`): `onboarding`, `import`, `upgrade`,
`nodejs -e|<stdin>`, `--version`, `--ego-server-name`. There is no listing,
watching or event subcommand: **all observation happens through app-authored
JavaScript in `nodejs`**.

## 2. What ego exposes, and what it does not

Authoritative and readable from outside the agent's round:

- space identity and lifecycle: `id`, `name`, `taskId`, `createdBy`,
  `ownership` (`agent` while the agent holds it, `user` after hand-off), and
  disappearance from the list after `finish()`;
- per-tab truth: `url`, `title`, `active`, `openedBy` (`agent` vs `unknown`),
  `label` (managed Pages) and `targetId`;
- viewport/scroll (`page.info()`) and a pixel-accurate `screenshot()`.

Not exposed, and therefore not renderable:

- **An action stream.** There is no "clicked X", "filled Y" feed. `page.events()`
  exists but *returns and clears* the buffered array — calling it from an
  observer would **steal events from the agent's own script**. It is
  permanently off-limits to the app.
- **Per-tool-call attribution.** ego knows nothing about GJC sessions, runs or
  `toolCallId`s.
- **Intent.** Why a page is open is only in the model's own text.

So the honest product is *"where the agent's browser is right now"* — space,
pages, current URL/title, and optionally the picture — never a synthetic
"clicking the login button" narration.

## 3. Why the Aside conclusion does not carry over

`aside-activity-contract.md` §4-6 rejected app-side rendering because every
candidate fact was class **M** (missing) or **H** (heuristic): the only signals
were an opaque Bash command string and model prose. For ego the same table
comes out differently, because a third party — ego lite itself — can be asked:

| Signal | Aside | ego |
| --- | --- | --- |
| A browser space/session exists for this machine | M | **A** — `listTaskSpaces()` |
| It is agent-driven right now | M | **A** — `ownership: "agent"`, tab `openedBy: "agent"` |
| Current URL / title | M | **A** — `tabs()` / `page.info()` |
| Visual state | M | **A** — `screenshot()` |
| Which GJC session/run owns it | M | **D\*** — app-issued token carried in the space name (§4) |
| Which tool call it belongs to | M | M |
| The current action (click/fill/nav) | M | M |
| Browser work is in flight at all | M | **D** — bash call in flight in an ego-backed run (existing tool frames) |

`D*` is the one new construct this design needs, and it is a token the *app*
generates, not a string it parses out of a command line.

## 4. Attribution: an app-issued run token

The app already owns the ego routing block — `buildGjcEgoBrowserInstructions()`
in `server/gjc-browser-backend.ts`, applied per run by `applyGjcBrowserBackend`
(`server/gjc-bun-sdk-adapter.ts:295`) after `enrichGjcSdkRunOptions`
(`server/gjc-worker-client.ts:304`) resolves the backend server-side. That
block already tells the model to use exactly one space per goal and to print
its `spaceId`.

Add one rule to it: the space name must start with an app-supplied token, e.g.

```text
const task = await taskSpace("gjc-4f19c2 · <short goal>");
```

where `gjc-4f19c2` is generated per session (never guessable content, no user
data). The observer then attributes a space to a session by exact prefix match
on `name`/`taskId` — a value the app minted, not a heuristic recovered from
shell syntax. Consequences, stated honestly:

- an ego space created without the token is **unattributed** and is not shown
  against a session (render nothing rather than guess);
- attribution is best-effort by construction, which is acceptable because
  everything it gates is read-only display, and every rendered *field* remains
  ego-authoritative.

## 5. Architecture

```text
Settings > Automation > Browser backend = ego lite  (existing)
        + Settings > Automation > Show browser activity  (new, opt-in)
   ↓
run starts (backend resolved server-side, block carries the run token)
   ↓
EgoActivityObserver (server, one per attributed session)
   ├─ starts when: backend=ego AND the run is active AND a bash call is in flight
   ├─ poll ~1 Hz: execFile(<probe-resolved path>, ['nodejs','-e', <fixed app script>])
   │     allowlist: listTaskSpaces() → taskSpace(id) → tabs() → page.info()
   │     (screenshot only when the picture surface is enabled)
   ├─ single in-flight poll, 2 s timeout, exponential backoff on error, hard stop when idle
   └─ snapshot in memory only: no SQLite row, no transcript write, no log line, TTL on run end
   ↓
GET /api/automation/ego-activity?sessionId=…      (TanStack Query, 1-2 s)
GET /api/automation/ego-activity/:spaceId/frame   (PNG, memory-cached, opt-in surface)
   ↓
WORK rail row  →  sidebar panel  →  live frame
```

Gating detail: "a bash call is in flight" is the class-D derivation the app
already makes from `tool_use` / final `tool_result` pairs; the run's
exactly-once terminal (`GJC-LIVE-SPEC.md` §Process and terminal lifecycle)
guarantees the observer always stops, exactly like the WORK rows in the Aside
design (§10 of that document). Auto-backgrounded bash (60 s threshold) changes
nothing: the observer follows ego, not the job.

Why not the existing WS projection (`gjc-job-projection.service.ts`)? That one
exists because GJC jobs have a durable authority with replay. Ego activity is
*ephemeral by policy* — nothing is persisted, an in-flight snapshot is worth
nothing after the run — so a polled REST read behind TanStack Query is the
correct, far smaller transport. No new WS frame type, no store, no table.

## 6. Execution authority: the doctrine change this requires

Today AGENTS.md and `docs/BROWSER-EGO-POC.md` state that **only** the explicit
Settings *Test connection* action may execute the CLI (`--version` plus the
documented `nodejs -e "console.log('ok')"` round trip). A background observer
executes `nodejs` repeatedly during runs. That is a real widening of the app's
execution authority and must land with explicit bounds:

- **app-authored fixed scripts only** — never model text, never interpolated
  user or page data; `execFile`, `shell: false`, minimal env, tight timeout,
  the probe-resolved absolute path (the existing `testEgoBrowserConnection`
  pattern);
- **read-only API allowlist**: `listTaskSpaces`, `taskSpace(id)`, `tabs`,
  `info`, `screenshot`. Never `goto`, `click`, `evaluate`, `cdp`, `adopt`,
  `release`, `claim`, `takeOver`, `handOff`, `finish`, `close`, `import`,
  `upgrade`, `onboarding`, and never `page.events()` (destructive read, §2);
- **agent-owned scope only**: spaces with `ownership: "agent"` and tabs with
  `openedBy: "agent"`. The user's own tabs, user-owned spaces and
  `openedBy: "unknown"` pages are never read, never listed, never captured;
- **fail-soft**: any CLI error, timeout or shape mismatch hides the surface and
  never touches the run. Browser work must never fail because rendering failed.

## 7. Privacy

This renders a logged-in personal browser inside an app that may be served over
a tailnet. Non-negotiables:

- opt-in per surface: *activity* (space/URL/title) and *frame* (screenshot) are
  two separate switches, both default off;
- memory only: no SQLite, no transcript, no log line, dropped on run end and on
  TTL;
- URL display is origin + path; query strings and fragments are dropped, since
  tokens live there;
- frames are served only for attributed agent-owned spaces, with
  `Cache-Control: no-store`, behind the app's normal auth;
- `profileName`/`profileId` from `listTaskSpaces()` are not rendered.

## 8. UI surfaces, in the order they should ship

1. **WORK row** (`AgentSidebarWork.tsx`). One row while an attributed space is
   live: `Browser · ego lite` with `Space 15 · example.com`. Same composition
   rules the Aside design fixed: in-flight only, never replaces or reorders
   TODOs, capped with `+N`, static subtitle, no elapsed-time or progress
   claims.
2. **Sidebar panel.** Space name, managed pages with their current URL/title,
   which tab is active, and a link that focuses ego lite. This is where the
   "what is the browser doing" question is actually answered.
3. **Live frame.** ~1 fps screenshot of the active agent tab in the panel,
   expandable. Read-only image: driving the browser from the app UI is a
   different product with a much larger security surface and is **not** part of
   this work.

Cost note: 10 locales (`src/i18n/locales/*`) and DOM tests
(`*.dom.bun.test.tsx`) are part of each UI step, not an afterthought.

## 9. Rejected alternatives

- **Model-declared progress markers in the script's stdout.** Dead on arrival
  for *live* progress: the CLI buffers everything until the round ends (§1), so
  the first marker and the last arrive together, with the tool result the app
  already has. It also inflates the routing block and is model-authored.
- **Parsing the bash command string.** The same class-E failure the Aside audit
  documented (§6 there), and needless here: ego answers the question directly.
- **A GJC runtime change (`browser.backend=ego`).** Correct eventually, and
  `docs/BROWSER-EGO-POC.md` already names it as the collapse point of this PoC,
  but it does not help: the runtime would still have no ego state feed, and it
  cannot ship in this repository.
- **Undocumented ego internals** (`--ego-server-name`, the CLI↔app transport,
  CDP through `task.cdp`). Out of contract, unversioned, and would break the
  "read-only allowlist" boundary.
- **A new main tab for the browser.** The main area deliberately has one tab;
  Shell/Git/Files were removed on purpose (`MainContentTabSwitcher.tsx`).

## 10. Risks

| Risk | Handling |
| --- | --- |
| ego CLI API drift (external, versioned 0.5.0.32 today) | tiny observer scripts, shape validation, fail-soft; the existing `EGO_VERSION_MATRIX` already tracks supported versions |
| One Node process per poll | 0.12-0.17 s, single in-flight poll, 1 Hz, only while a bash call is in flight, backoff on error, stop when idle |
| Attribution misses (no token in the space name) | unattributed spaces render nothing; never guessed |
| Two sessions driving ego at once | token disambiguates; without a token, neither claims the space |
| Screenshot sensitivity | separate opt-in, agent-owned tabs only, no-store, memory TTL |
| Remote server, local browser | ego readiness is already filesystem-local; the observer inherits the same "ego runs where the server runs" assumption |

## 11. Suggested PR sequence

- **PR 1 — observer + WORK row** (foundation). Run token in the routing block,
  `EgoActivityObserver` with the §6 bounds, run/bash gating, opt-in setting,
  `GET /api/automation/ego-activity`, WORK row, doctrine updates (AGENTS.md,
  `docs/BROWSER-EGO-POC.md`, this file), tests with an injected `execFile` (no
  real CLI needed) plus a DOM test for the row. Estimate ~700-900 lines with
  tests.
- **PR 2 — sidebar panel.** Pages list, active tab, focus-ego action, i18n ×10,
  DOM tests. ~300 lines.
- **PR 3 — live frame.** Screenshot poll, PNG endpoint with TTL cache, second
  opt-in switch, privacy gates, tests. ~400 lines.

PR 1 is the only one that carries new authority; 2 and 3 are additive UI over
the snapshot it already produces. Each is independently shippable, and each
degrades to "no surface" rather than to a wrong surface.

## 12. Non-goals

- No driving the browser from the app UI (no click/type/navigate from a frame).
- No `page.events()`, no CDP, no undocumented ego transport.
- No reading user-owned spaces, user tabs or unknown-origin pages.
- No persistence: no table, no transcript entry, no log of visited URLs.
- No ACTION REQUIRED broadening; a browser that waits inside ego is still just
  "running" here.
- No change to the no-fallback policy: ego unavailable still means browser work
  is unavailable, never a substitution.
- No Aside or Built-in rows riding this contract (Built-in is already
  structurally visible as the first-party `browser` tool).
