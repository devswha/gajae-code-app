# OpenCodex CUA benchmark PoC

This PoC uses OpenCodex as a **benchmark adapter**, not as a production dependency of Gajae Code App.
Codex remains the executor and approval authority for its Browser and Computer Use plugins. Gajae's
production path remains the Chromium/CDP browser sidecar plus the CUA Driver transport.

## Boundary

```text
benchmark: Codex UI/CLI -> OpenCodex -> selected model -> Codex node_repl -> Computer Use
production: Gajae agent -> browser sidecar (web) / CUA Driver (native apps)
```

OpenCodex's routed `code_mode_only` model rows can request Codex-owned local tools, but they do not
copy the Computer Use implementation into Gajae. This makes the PoC useful for measuring tool
selection, recovery, latency, and UI-operation quality while keeping the production security boundary
unchanged. See the OpenCodex [routed local tools documentation](https://github.com/lidge-jun/opencodex/blob/main/docs-site/src/content/docs/guides/codex-integration.md#routed-local-tools)
and the official [Codex Computer Use guide](https://learn.chatgpt.com/docs/computer-use).

## Installed benchmark profile

The isolated profile uses:

- OpenCodex home: `$HOME/.opencodex-gajae-poc`
- Proxy/dashboard: `http://127.0.0.1:10100`
- Routed model: `ollama/qwen2.5:7b-instruct`
- Codex catalog row: `tool_mode=code_mode_only`, `node_repl_disabled=false`
- Per-model reasoning override: an empty ladder, because this Qwen build rejects a `thinking` field
- Pre-PoC Codex config backup: `$HOME/.opencodex-gajae-poc/backups/codex-config.before.toml`

The app and the benchmark share the installed Codex Computer Use plugin, but they do not share
Gajae's CUA Driver daemon or grants.

## Repeatable checks

Use the repository's Node version so the globally installed `ocx` command is on `PATH`:

```bash
. "$HOME/.nvm/nvm.sh"
nvm use 22
OPENCODEX_HOME="$HOME/.opencodex-gajae-poc" npm run poc:opencodex:cua
```

The default command is read-only. It checks the isolated config, proxy readiness, Ollama model,
Codex catalog capabilities, and the enabled `node_repl` MCP server.

The live comparison invokes models and therefore consumes local compute and native Codex quota:

```bash
OPENCODEX_HOME="$HOME/.opencodex-gajae-poc" npm run poc:opencodex:cua -- --live
```

`--live` treats a local-model tool miss as a measured quality gap rather than an infrastructure
failure. Add `--strict-local` when that gap should fail a promotion gate. Set
`OPENCODEX_NATIVE_MODEL` or `OPENCODEX_POC_MODEL` to compare different models.

## Baseline recorded on 2026-08-21

| Scenario | Result | Evidence |
| --- | --- | --- |
| OpenCodex service and Ollama discovery | Pass | Proxy ready; provider probe found two local models |
| Routed local text response | Pass | `qwen2.5:7b-instruct` returned `POC_OK` through Codex/OpenCodex |
| Native Codex `node_repl` call through the same proxy | Pass | `gpt-5.6-sol` completed the MCP call and returned `NATIVE_CUA_OK` |
| Native Codex Computer Use runtime | Pass | Read-only `sky.list_apps()` returned 20 apps |
| Routed local Computer Use selection | Gap | Qwen received four tools but emitted no completed `node_repl` call |

The current gap is model quality, not a broken bridge: the native model can call the same MCP server
through the same proxy, and the Computer Use runtime itself succeeds. A stronger routed model should
be evaluated before drawing conclusions about OpenCodex's tool translation quality.

## Gajae comparison scenario

Run the same read-only-to-interactive sequence against both backends:

1. List apps and inspect one app without mutation.
2. Open TextEdit, type a unique marker, and verify it is visible.
3. Open a localhost page, inspect it, click one control, and verify the resulting state.
4. Deny a permission once, grant it once, revoke it, and retry.
5. Stop an in-flight operation and verify that the app, proxy, and driver remain alive.

Record task completion, wrong-action count, approval prompts, time to first action, total duration,
and recovery outcome. Codex is the quality reference; parity does not require reusing Codex's private
Computer Use runtime.

After running `ocx sync`, restart Codex and open a fresh task before testing the routed model in the
desktop picker. An existing app-server process keeps its old catalog in memory.

## Pause or remove the PoC

Restore native Codex routing and stop the background service:

```bash
. "$HOME/.nvm/nvm.sh"
nvm use 22
OPENCODEX_HOME="$HOME/.opencodex-gajae-poc" ocx stop
```

For full OpenCodex removal, use `ocx uninstall` with the same `OPENCODEX_HOME`. Neither command
removes Gajae's browser sidecar, CUA Driver settings, or grants.
