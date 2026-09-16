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
      ├─ probeEgoBrowserCli()            ~/.local/bin/ego-browser, then PATH; resolved path is pinned
      ├─ settings.override('browser.backend', 'native')   no Aside block from a user-level setting
      ├─ settings.override('browser.enabled', false)      runtime built-in browser tool unavailable
      ├─ browser removed from toolNames + automationTools (WebView transport withheld)
      └─ systemPrompt += GJC_EGO_BROWSER_INSTRUCTIONS     app-owned <browser-backend> block
      ↓
runtime Bash tool  →  '<resolved absolute path>' nodejs <<'EOF' … EOF   (user-installed CLI)
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
(Experimental)** or **ego lite (Experimental)** on macOS. Persisted under
`automation.browserBackend.v1`; `GET`/`PUT /api/automation/browser-backend`
accept `builtin | aside | ego` (the Ego option is platform-gated). The value is
resolved server-side for every GJC run (`enrichGjcSdkRunOptions`) and never
taken from a client request.

- `GET /api/automation/ego-readiness` is filesystem-only and reports the
  structured taxonomy (`ego_cli_missing`, dangling/non-executable CLI, app and
  skill state, version and platform checks). It never executes, installs,
  repairs or writes, and never returns absolute paths. Unknown app-running,
  connection and CLI/app-skew states remain `unknown` warnings rather than
  being treated as ready.
- `POST /api/automation/ego-readiness/test` is only called by the explicit
  Settings **Test connection** button. It executes the probe-resolved absolute
  path with `execFile`, `shell: false`, a minimal environment and a tight
  timeout, first parsing `--version` and then running the documented
  `nodejs -e "console.log('ok')"` round trip. It never runs `import`, `upgrade`
  or `onboarding`.
- Both CLI callers share one runner (`execEgoFile`) because ego-browser 0.5
  behaves two ways a plain `promisify(execFile)` gets wrong: it waits for EOF
  on stdin before running a `nodejs` program, so the parent must close the
  child's stdin or every call dies on its timeout; and when its output is piped
  it writes both the program's `console.log` and the `--version` banner to
  **stderr**. Checks read the combined content, never the stream it arrived on.
- A missing or not-ready Ego CLI keeps the session alive for ordinary chat and
  coding while browser work is unavailable. There is no fallback or
  substitution to Built-in, Aside, an OS browser, Playwright, Puppeteer, MCP
  or computer/CUA. The computer tool remains available only for legitimate
  non-browser app automation.
- With ego selected the Browser panel's WebView is not what the agent drives;
  the panel is unchanged and still works for the user directly.

## Browser activity in the app

`Settings > Automation > Show browser activity` (opt-in, off by default,
`automation.egoActivity.v1`) renders what the agent's browser is doing in the
agent sidebar's WORK lane: the live Space, its goal and the page it is on.

The state comes from ego lite, not from the session: `GET
/api/automation/ego-activity?sessionId=…` runs a fixed app-authored script
(`EGO_ACTIVITY_SCRIPT`) that calls only `listTaskSpaces()`, `taskSpace(id)` and
`tabs()`. Measured on ego-browser 0.5.0.32, that read takes 0.12-0.17 s and does
not disturb a script already working in the same space. Attribution uses a token
the app mints from the app session id (`egoActivityToken`) and requires in the
routing block's space-naming rule, so no Bash command is ever parsed.

`Settings > Automation > Show the browser screen` is a second, separate opt-in
(`automation.egoActivityFrame.v1`, off by default, and unavailable until the
activity surface is on). With it enabled, expanding a Space row adds a small
JPEG of the page the agent is on, refreshed about once a second while the row
stays open. `GET /api/automation/ego-activity/frame?sessionId=&space=&page=`
serves it: the space and page must be in that session's attributed snapshot,
the program interpolates only a validated space id and `pN` label, it calls
exactly one CDP method (`Page.captureScreenshot`, quality 35, scaled to ≤640px)
and returns bytes, so nothing is written to disk. Measured on ego-browser
0.5.0.32 with the ego window behind the app: 10/10 captures, median 50 ms,
27 KB scaled. A **minimized** ego window produces no compositor frames at all -
that capture times out and the surface simply shows no picture.

Bounds: nothing executes while the surface is off, the backend is not ego, the
platform is unsupported or no session id is supplied; only agent-created,
agent-owned spaces carrying this session's token and their agent-opened pages
are read; URLs are reduced to origin and path; one execution serves every reader
inside a one-second window; nothing is persisted; and any failure hides the
surface instead of failing the run. `page.events()` is never called - its read
clears the buffer the agent's own script depends on. Full design record and
evidence: `docs/plans/ego-activity-contract.md`.

## Design decisions

1. **Why not `browser.backend=aside` plus a different prompt?** The runtime's
   Aside value injects the Aside routing block verbatim; the model would be
   told to run `aside repl` and load the `aside` skill. The runtime setting has
   to stay `native`, so the app hides the built-in tool itself
   (`browser.enabled=false`, `browser` filtered from `toolNames` and
   `automationTools`) and appends its own block.
2. **Why an app-owned probe?** The runtime's `probeAsideCli` knows Aside's
   paths only. `probeEgoBrowserCli` is probe-only (stat + X_OK, never executes
   the CLI, never installs), while `probeEgoReadiness` adds filesystem-only app,
   skill and version checks. Both are portable across the Node server and the
   Bun worker and injectable in tests.
3. **Why does the block not document the API?** The `ego-browser` skill is
   versioned with ego lite and is the complete reference (TaskSpace, Page,
   FileChooser, mouse, keyboard). The block names the entry point
   (the probe-resolved absolute path followed by `nodejs <<'EOF'`), the one-Space-per-goal rule, the
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

- `server/gjc-browser-backend.test.ts` — value set, every readiness taxonomy
  state with an injected filesystem, POSIX-quoted absolute routing path,
  prohibited subcommands/substitution and safe fixed text.
- `server/gjc-sdk-contract.bun.test.ts` — adapter seam: ego writes
  `browser.backend=native` + `browser.enabled=false`, yields `computer`-only
  automation tools, removes `browser` from `toolNames`, keeps `bash`, appends
  the block last in the system prompt, probes ego once and Aside never;
  a missing CLI keeps ordinary chat alive with no browser tools, and no probe
  path on the wire; Built-in and Aside never receive the ego block.
- `server/gjc-worker.test.ts`, `server/gjc-worker-client.test.ts` — ordinary
  chat remains usable when the Ego browser block reports an unavailable CLI;
  probe paths stay out of the wire.
- `server/modules/automation/browser-backend.test.ts`,
  `server/modules/automation/automation.routes.test.ts` — store, resolver,
  readiness shape/path redaction, GET-without-execution and explicit test route.
- `src/components/settings/view/tabs/AutomationSettingsTab.dom.bun.test.tsx` —
  the third option, its note and description, persistence.

Manual (macOS, ego lite installed and onboarded, `ego-browser` 2.0.0 skill
symlinked into `~/.gjc/agent/skills/ego-browser`; app served from this branch
on a throwaway DB with `PUT /api/automation/browser-backend {backend:"ego"}`,
session over `chat.send`, Bash approved through the app's permission card):

1. **Not ready**: with the CLI or skill unavailable, an ordinary `hello` run
   still starts. Its browser tool is disabled, the unavailable-browser policy
   is present, and no Built-in/Aside/OS/CUA substitution is attempted.
2. **Positive**: "Open https://example.com in the browser and tell me the page
   title. Then finish the browser task." Tool calls in order: `skill`
   (`ego-browser`), `read` (its SKILL.md, twice), `bash` →
   `'<resolved absolute path>' nodejs <<'EOF' const task = await taskSpace("open example.com");
   const page = task.page("p1"); await page.goto("https://example.com"); … EOF`.
   ego lite opened Space 1; answer "the page title is **Example Domain**. The
   browser task space (id 1) has been finished with no pages kept open." Zero
   `browser` tool calls, zero Aside text.
3. With ego lite installed but `~/.local/bin/ego-browser` renamed, Settings
   reports `ego_cli_missing`; clicking Test connection performs no onboarding
   or repair and returns a bounded failure while ordinary chat remains usable.

## Follow-ups (not implemented)

- A live frame (≈1 fps `screenshot()` of the active agent tab) behind its own
  opt-in; see `docs/plans/ego-activity-contract.md` §8. The state surface above
  ships; the picture does not.
- Runtime-native `browser.backend=ego` in `@gajae-code/coding-agent`, at which
  point the app's probe and block move there and this PoC collapses to the
  Aside shape.
