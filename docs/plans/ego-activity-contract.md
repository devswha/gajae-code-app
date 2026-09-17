# ego browser activity contract

Status: §11 shipped in full - PR 1 (reader, opt-in, WORK row), PR 2 (space
detail), PR 3 (page frame) - 2026-09-16.
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

Implementation added two more, both found by running the real CLI from the
server instead of a shell, and both now covered by tests:

| Probe | Result |
| --- | --- |
| `nodejs -e <script>` through `child_process.execFile` | **hangs** until the timeout kills it: the CLI waits for EOF on stdin before running the program, and an inherited pipe never closes |
| the same call with the child's stdin closed | answers in ~0.1 s |
| where a piped CLI writes | **stderr** — both the program's `console.log` and the `--version` banner; stdout stays empty |

The second row also explains a shipped bug: `testEgoBrowserConnection` (Settings
> Test connection) used `promisify(execFile)` and required the version on
stdout with an empty stderr, so against ego-browser 0.5.0.32 it reported
`ego_connection_failed` for a perfectly healthy install. Both callers now share
one runner that closes stdin and judges content rather than the stream it
arrived on.

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
        + Settings > Automation > Show browser activity  (new, opt-in, off)
   ↓
run starts (backend resolved server-side, block carries the session token)
   ↓
client (agent sidebar) polls only while this session is running
   ↓
GET /api/automation/ego-activity?sessionId=…
   ├─ nothing executes unless: opted in AND platform supports ego AND backend=ego
   ├─ execFile(<probe-resolved path>, ['nodejs','-e', EGO_ACTIVITY_SCRIPT]), shell:false, minimal env
   │     allowlist: listTaskSpaces() → taskSpace(id) → tabs()
   ├─ one execution shared by every reader inside a 1 s window (single-flight + TTL)
   ├─ attribution: space name starts with egoActivityToken(appSessionId)
   └─ in memory only: no SQLite row, no transcript write, no log line; no-store on the wire
   ↓
WORK rail row  →  space detail  →  live frame (PR 3, not implemented)
```

Gating detail: "while the session is running" is the same authoritative run
state WORK already renders, and the run's exactly-once terminal
(`GJC-LIVE-SPEC.md` §Process and terminal lifecycle) guarantees the polling
always stops. A per-Bash-call gate was considered and dropped: ego's own space
lifecycle already says when browser work exists, so deriving a second, weaker
answer from tool frames would only add a way to disagree with it.

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
   live: the Space's goal and the page ego reports as active. Same composition
   rules the Aside design fixed: in-flight only, never replaces or reorders
   TODOs, capped with `+N`, static subtitle, no elapsed-time or progress
   claims.
2. **Space detail** (`AgentSidebarBrowser.tsx`). The same row expands to the
   Space's other pages with their titles and addresses, because a browser job
   that opened three tabs is when one line stops being enough. A second section
   repeating the row was rejected: in a 256 px lane that is duplication, not
   detail.
3. **Page frame** (`AgentSidebarBrowser.tsx`). A scaled-down JPEG of the active
   page inside the expanded row, refreshed ~1/s while it is open, removed on a
   failed capture. Read-only image: driving the browser from the app UI is a
   different product with a much larger security surface and is **not** part of
   this work. Captures happen only while a row is expanded, so a collapsed lane
   costs nothing in the user's real browser.

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

- **PR 1 — observer + WORK row** (foundation). **Shipped.** Run token in the
  routing block (`buildGjcEgoBrowserInstructions(cliPath, token)`,
  `egoActivityToken`), the reader with the §6 bounds
  (`server/gjc-ego-activity.ts`), gating and single-flight caching
  (`server/modules/automation/ego-activity.ts`), opt-in setting
  (`automation.egoActivity.v1`), `GET`/`PUT /api/automation/ego-activity`, the
  WORK row, and doctrine updates in AGENTS.md, `server/GJC-LIVE-SPEC.md` and
  `docs/BROWSER-EGO-POC.md`.

  Two design points moved during implementation, both toward less machinery:
  the client polls only while the session is running and stops as soon as the
  server reports the surface off, which makes a background observer loop and
  its run-registry wiring unnecessary; and the per-call "bash in flight" gate
  was dropped, because ego's own space lifecycle already answers when browser
  work exists and a Bash-derived gate would add a second, weaker source.
- **PR 2 — space detail.** **Shipped** as `AgentSidebarBrowser.tsx`: every page
  of the live space with its title, address and which one is active, as a
  disclosure on the WORK row rather than a second section repeating it. A space
  with no page yet is not expandable, the active page is marked with
  `aria-current` rather than by colour, and a page without a title falls back to
  its address. i18n ×10, DOM tests.
- **PR 3 — page frame.** **Shipped.** `buildEgoFrameScript` + `readEgoFrame`,
  `GET /api/automation/ego-activity/frame`, a second opt-in
  (`automation.egoActivityFrame.v1`) that cannot be switched on before the
  activity surface, and a picture that mounts only inside an expanded row.

  Three things changed against the plan, all from measurement:

  - **The capture is the one CDP call the app makes.** `page.screenshot({path})`
    would write pictures of a signed-in browser to disk;
    `Page.captureScreenshot` hands back base64 that stays in memory. The
    read-only allowlist is widened by exactly that one method, written down in
    AGENTS.md.
  - **Occlusion is not the blocker it first appeared to be.** An early probe
    made every capture time out and nearly killed this PR; a controlled rerun
    with the ego window behind the app gave 10/10 captures, median 50 ms,
    145 KB full size and 27 KB scaled to 640px. The real failure mode is a
    **minimized** window, which produces no compositor frames at all - hence the
    short timeout and a 404 that renders nothing rather than a retry loop.
  - **The frame is parameterised, unlike the observation script**, so the
    parameters are validated instead of escaped: a positive integer space id and
    an ego `pN` label, with everything else refused before the program is built.

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
