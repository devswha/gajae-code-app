# ego lite browser backend in app sessions (PoC)

Proof of concept that a GJC session started by Gajae Code App can drive
[ego lite](https://github.com/citrolabs/ego-lite) through its `ego-browser`
CLI, the same way the Aside PoC (`docs/BROWSER-ASIDE-POC.md`) drives the Aside
CLI. The difference: the runtime (`@gajae-code/coding-agent`) has no ego
backend of its own (`browser.backend` is `native | aside`), so the app owns the
two pieces the runtime owns for Aside — the CLI probe and the routing block.

```text
Gajae Code App  (Settings > Automation > Browser backend = ego lite)
      ↓  automation.browserBackend.v1  →  run option browserBackend: 'ego'
GJC worker  (gjc-bun-sdk-adapter.ts: applyGjcBrowserBackend)
      ├─ probeEgoBrowserCli()            ~/.local/bin/ego-browser, then PATH; missing → ego_unavailable
      ├─ settings.override('browser.backend', 'native')   no Aside block from a user-level setting
      ├─ settings.override('browser.enabled', false)      runtime built-in browser tool unavailable
      ├─ browser removed from toolNames + automationTools (WebView transport withheld)
      └─ systemPrompt += GJC_EGO_BROWSER_INSTRUCTIONS     app-owned <browser-backend> block
      ↓
runtime Bash tool  →  ego-browser nodejs <<'EOF' … EOF   (user-installed CLI, login shell PATH)
      ↓
ego lite browser  (agent Space, user's logged-in profile)
```

## What ego lite is

ego lite is a Chromium-based desktop browser (macOS today) built for humans and
agents to share: the agent works in its own **Space** while the user's tabs stay
untouched, and it inherits the user's logins. Any agent drives it through the
`ego-browser` CLI, which runs a JavaScript snippet in a Node.js runtime with
`taskSpace()` / `page.goto()` / `page.snapshot()` / `page.click()` … helpers.
The agent-facing API and workflow live in the `ego-browser` skill that ego lite
installs into every agent's skills directory (or `npx skills add
citrolabs/ego-lite`). Install: download from <https://lite.ego.app/>, finish
onboarding; onboarding registers `~/.local/bin/ego-browser`.

Observed with ego lite 2026-09 on macOS: onboarding registers the skill for
Claude Code and Codex only (`~/.claude/skills/ego-browser` and
`~/.agents/skills/ego-browser`, both symlinks to
`~/.local/share/ego/ego-skills`), not for GJC. GJC scans `~/.gjc/agent/skills`
and the project's `.gjc/skills`, so the user registers it once the same way:

```bash
ln -s ~/.local/share/ego/ego-skills ~/.gjc/agent/skills/ego-browser
```

A symlink, not a copy, so ego lite updates keep the skill current. Without it
the routing block's "load the installed `ego-browser` skill" has nothing to
load and the model falls back to the block alone.

## Setting

`Settings > Automation > Browser backend`: **Built-in** (default), **Aside
(Experimental)** or **ego lite (Experimental)**. Persisted under
`automation.browserBackend.v1`; `GET`/`PUT /api/automation/browser-backend`
accept `builtin | aside | ego`. The value is resolved server-side for every GJC
run (`enrichGjcSdkRunOptions`) and never taken from a client request.

- ego with no `ego-browser` CLI fails the run with `ego_unavailable` before a
  session exists, with fixed text and no probe paths on the wire. There is no
  fallback to Built-in: a session that silently ran in the app's WebView would
  act in the wrong browser profile.
- With ego selected the Browser panel's WebView is not what the agent drives;
  the panel is unchanged and still works for the user directly.

## Design decisions

1. **Why not `browser.backend=aside` plus a different prompt?** The runtime's
   Aside value injects the Aside routing block verbatim; the model would be
   told to run `aside repl` and load the `aside` skill. The runtime setting has
   to stay `native`, so the app hides the built-in tool itself
   (`browser.enabled=false`, `browser` filtered from `toolNames` and
   `automationTools`) and appends its own block.
2. **Why an app-owned probe?** The runtime's `probeAsideCli` knows Aside's
   paths only. `probeEgoBrowserCli` is probe-only (stat + X_OK, never executes
   the CLI, never installs), portable across the Node server and the Bun
   worker, and injectable in tests.
3. **Why does the block not document the API?** The `ego-browser` skill is
   versioned with ego lite and is the complete reference (TaskSpace, Page,
   FileChooser, mouse, keyboard). The block names the entry point
   (`ego-browser nodejs <<'EOF'`), the one-Space-per-goal rule, the
   `console.log` / `finish()` contract and the safety boundaries, and tells the
   model to load the installed skill. Copying the API into the app would rot.
4. **Where does the block go?** The adapter already appends
   `GAJAE_APP_ENV_NOTE` through `createAgentSession`'s `systemPrompt` hook; the
   ego block is appended after it, mirroring where the runtime appends its
   Aside block (`session.ts`: memory instructions + browser backend
   `developerInstructions`).
5. **Skill discovery is unchanged.** The adapter passes no explicit skill list,
   so a user-installed `ego-browser` skill in `~/.gjc/agent/skills` (or the
   project's `.gjc/skills`) is discoverable and loadable through the `skill`
   tool exactly like the `aside` skill in the Aside PoC.

## Validation

Automated (no ego lite required; the probe is injected):

- `server/gjc-browser-backend.test.ts` — value set, `ego_unavailable`
  code/text, probe order (onboarding path, then `PATH`, searched list), and the
  routing block's invariants (entry point, skill, no MCP, no Aside text).
- `server/gjc-sdk-contract.bun.test.ts` — adapter seam: ego writes
  `browser.backend=native` + `browser.enabled=false`, yields `computer`-only
  automation tools, removes `browser` from `toolNames`, keeps `bash`, appends
  the block last in the system prompt, probes ego once and Aside never;
  a missing CLI answers `ego_unavailable` with no session, no overrides and no
  probe path on the wire; Built-in and Aside never receive the ego block.
- `server/gjc-worker.test.ts`, `server/gjc-worker-client.test.ts` — the fixed
  code and text cross the worker protocol; probe paths stay in diagnostics.
- `server/modules/automation/browser-backend.test.ts`,
  `server/modules/automation/automation.routes.test.ts` — store, resolver, REST
  validation with the three-value set.
- `src/components/settings/view/tabs/AutomationSettingsTab.dom.bun.test.tsx` —
  the third option, its note and description, persistence.

Manual (macOS, ego lite installed and onboarded, `ego-browser` 2.0.0 skill
symlinked into `~/.gjc/agent/skills/ego-browser`; app served from this branch
on a throwaway DB with `PUT /api/automation/browser-backend {backend:"ego"}`,
session over `chat.send`, Bash approved through the app's permission card):

1. **Negative first, before ego lite was installed**: the run failed
   immediately with the fixed `ego_unavailable` text as a chat `error` frame
   followed by `complete exitCode 1`; no session started, no override written.
2. **Positive**: "Open https://example.com in the browser and tell me the page
   title. Then finish the browser task." Tool calls in order: `skill`
   (`ego-browser`), `read` (its SKILL.md, twice), `bash` →
   `ego-browser nodejs <<'EOF' const task = await taskSpace("open example.com");
   const page = task.page("p1"); await page.goto("https://example.com"); … EOF`.
   ego lite opened Space 1; answer "the page title is **Example Domain**. The
   browser task space (id 1) has been finished with no pages kept open." Zero
   `browser` tool calls, zero Aside text.
3. With ego lite installed but `~/.local/bin/ego-browser` renamed, the run is
   refused exactly as in step 1.

## Follow-ups (not implemented)

- Settings-time readiness indicator (a worker request running
  `probeEgoBrowserCli`, optionally `ego-browser --version`).
- Surfacing the running Space in the WORK sidebar; see the authority analysis
  in `docs/plans/aside-activity-contract.md` — the same "prompt-routed Bash"
  limits apply to ego.
- Runtime-native `browser.backend=ego` in `@gajae-code/coding-agent`, at which
  point the app's probe and block move there and this PoC collapses to the
  Aside shape.
