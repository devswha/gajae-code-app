# Aside browser backend in app sessions (PoC)

Proof of concept that a GJC session started by Gajae Code App can use GJC's
existing Aside browser integration. The app implements no Aside backend: it
stores one setting and hands it to the runtime's own `browser.backend`.

```text
Gajae Code App  (Settings > Automation > Browser backend)
      ↓  automation.browserBackend.v1  →  run option browserBackend
GJC worker  (gjc-bun-sdk-adapter.ts: settings.override('browser.backend', 'aside'))
      ↓
existing GJC browser-aside routing  (prompts/agent-fragments/browser-aside.md)
      ↓
existing GJC `aside` skill  (user-installed, <agentDir>/skills/aside)
      ↓
user-installed Aside CLI  (~/.local/bin/aside, via the runtime's Bash tool)
      ↓
Aside Browser
```

## Setting

`Settings > Automation > Browser backend`: **Built-in** (default) or
**Aside (Experimental)**. Persisted in the app's `app_config` table under
`automation.browserBackend.v1`; `GET`/`PUT /api/automation/browser-backend`.
The value is resolved server-side for every GJC run (`enrichGjcSdkRunOptions`)
and never taken from a client request.

- Built-in writes `browser.backend=native` on the per-run settings clone. This
  is an explicit runtime selection, so a user-level Aside setting cannot change
  the app's selected surface. Built-in browser automation is available only in
  the supported desktop implementation; web/self-host sessions receive an
  unavailable browser toolset rather than a Puppeteer fallback.
- Aside overrides `browser.backend` to `aside` on the per-run settings clone and
  withholds the app's WebView `browser` transport, because the SDK registers a
  supplied automation tool unconditionally. Everything after that is the
  runtime's: the routing block, the tool hiding, the repl/exec policy, the skill
  instruction.
- Aside with no Aside CLI fails the run with `aside_unavailable` before a
  session exists. The probe is the runtime's own `probeAsideCli`; there is no
  fallback to Built-in. Choose Built-in only where it is available.
- Existing stored `native` values are read as Built-in for compatibility and are
  not rewritten; new API writes must use `builtin` or `aside`.

## Findings (observed)

1. **How does the app pass `browser.backend=aside`?** Through the runtime's
   settings boundary: `settings.override('browser.backend', 'aside')` on the
   clone every run already receives (`applyGjcBrowserBackend`). No second
   configuration system; the CLI equivalent is `gjc config set browser.backend
   aside`.
2. **Does an app-created session receive the existing browser-aside routing?**
   Yes. The runtime's `createAgentSession` calls `resolveBrowserBackend(settings)`
   for both the prompt and the tool filter. With the override, the system prompt
   carries the runtime's `<browser-backend>` block verbatim (`aside repl`,
   `aside exec`, "Load the installed GJC `aside` skill"); without it, it does
   not. Verified against the pinned runtime in
   `server/gjc-browser-backend.bun.test.ts` and live (below).
3. **Can it discover and load the existing `aside` skill?** Yes. The adapter
   passes no explicit skill list and leaves `skills.enabled` alone, so the
   runtime scans `<agentDir>/skills` (`~/.gjc/agent/skills` by default, the
   CLI's location) and the project's `.gjc/skills`. A user-scope `aside` skill
   placed in a temp agent dir is discovered by an app-built session; a
   project-scope fixture was loaded live through the `skill` tool. No gap was
   found, so nothing was fixed here; nothing was copied into the app.
4. **Are HOME, PATH, config and skill paths correct?** The worker inherits the
   server's environment plus `GJC_WORKER_AGENT_DIR` (default `~/.gjc/agent`).
   The SDK session's `agentDir` is the runtime default (`getAgentDir()`,
   HOME-derived, `GJC_CODING_AGENT_DIR` honored), which is the same directory by
   default. The runtime's Bash tool runs commands through a **login shell**
   (`$SHELL -l -c`), so `aside` on the user's login PATH is found even when the
   desktop app inherited launchd's minimal PATH; the pre-start probe checks the
   two absolute install locations first and `PATH` last.
5. **Does GJC invoke the user-installed Aside CLI?** Yes: every browser action in
   the live runs was a `bash` call of `aside repl '<code>'`; the Aside browser
   opened the tabs and performed the click; zero `browser` tool calls.
6. **Is any custom Aside integration necessary in the app?** No. The app change
   is a setting, a run option, one settings override, one automation-tool
   filter, and a pre-start probe that reuses the runtime's discovery. The one
   thing the app *had* to do is the filter: without it the app's WebView tool
   would still be registered beside a prompt saying the built-in browser is
   disabled (the SDK bypasses `isAvailable` for supplied automation tools).
7. **Limitations observed.**
   - The readiness probe runs in the worker at session start, not in Settings.
     The runtime's `probeAsideCli` is Bun-only, so a Settings-time indicator
     would need a worker request; not built for the PoC.
   - `probeAsideCli` consults the worker process's `PATH`, while the model's
     Bash uses a login shell. An Aside installed only on a login-shell PATH
     entry that the desktop app did not inherit would be refused at start even
     though Bash could reach it. The official installer's `~/.local/bin/aside`
     and the `Aside CLI.app` bundle are absolute candidates and unaffected.
   - The Aside-unavailable refusal applies to every turn while Aside is
     selected, including turns that need no browser. Deliberate: a session
     that silently ran in the app's WebView would act in the wrong profile.
   - A user with `browser.backend: aside` in their own GJC configuration gets
     the selected Built-in runtime mode when the app chooses Built-in; the
     per-run override prevents a mixed configuration.
   - With Aside selected the Browser panel's WebView is not what the agent
     drives; the panel is unchanged and still works for the user directly.
   - The runtime's Aside skill instruction only applies when a user-installed
     `aside` skill exists; the app does not ship one and must not.

## Validation

Automated (no Aside required; CLI probe injected, skill is a fixture):

- `server/gjc-browser-backend.bun.test.ts` — real pinned runtime: Built-in
  overrides an inherited Aside setting, keeps the app browser tool and injects
  no routing; Aside hides the tool (active and
  discoverable), injects the runtime's block, sets `browser.backend=aside`, and
  discovers `<agentDir>/skills/aside`; a missing CLI is refused before any
  session with the override never written.
- `server/gjc-sdk-contract.bun.test.ts` — adapter seam: Built-in explicitly
  overrides to runtime native mode without probing Aside; Aside gets
  `computer`-only automation tools; the
  `aside_unavailable` response with no session created; malformed values
  rejected.
- `server/gjc-worker.test.ts`, `server/gjc-worker-client.test.ts` — the fixed
  code and text cross the worker protocol; probe paths stay in diagnostics.
- `server/gjc-browser-backend.test.ts`, `server/modules/automation/browser-backend.test.ts`,
  `server/modules/automation/automation.routes.test.ts` — value set, store,
  resolver, REST validation.
- `src/components/settings/view/tabs/AutomationSettingsTab.dom.bun.test.tsx` —
  selector defaults, persists, explains the no-fallback contract, reports a
  rejected save.

Manual (macOS, Aside CLI 1.26.810.1915 at `~/.local/bin/aside`, live Aside
browser; model `anthropic/claude-sonnet-5`; harmless public pages only):

- CLI baseline (`gjc` 0.16.6, project `.gjc/settings.json` `browser.backend:
  aside`, `gjc -p --mode json`): the only tool calls were `bash` →
  `aside repl '…openTab("https://example.com")…'`; answer "Example Domain".
- App (`server/index.js` on a throwaway DB, `PUT /api/automation/browser-backend
  {backend:"aside"}`, session over `chat.send`): same task, tool calls
  `["bash","bash"]`, both `aside repl`, both approved through the app's
  permission card; answer "Example Domain". Zero `browser` tool calls.
- App, deterministic interaction: load the `aside` skill (project-scope fixture
  with a marker line) then click the first checkbox on
  `the-internet.herokuapp.com/checkboxes` and verify with a fresh DOM read. Tool
  calls: `skill` (`aside`), `read` (its SKILL.md), then seven `bash` →
  `aside repl` calls; the marker was quoted and "checkbox 1 = checked, checkbox
  2 = checked" reported from a fresh `page.evaluate`.
- App tool inventory, no tool calls: Built-in lists `proxy_browser` and reports no
  `<browser-backend>` block; Aside omits it and reports the block.

## Follow-ups (not implemented)

- Settings readiness indicator via a worker request that runs the runtime's
  `probeAsideCli` (path, `--version`).
- Pass the worker's `GJC_WORKER_AGENT_DIR` as the session `agentDir` so a
  non-default worker agent dir also governs skill/MCP discovery.
- Anything the task scoped out: sidebar/activity cards, native removal,
  streaming or embedding the Aside window, MCP.
