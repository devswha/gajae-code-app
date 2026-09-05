# App delegation and native workflows

`server/gjc-delegation-executor.ts` owns the app's `task` and `subagent`
tools. The raw SDK task executor remains excluded: the offline regression in
`server/gjc-sdk-contract.bun.test.ts` demonstrates its parent-permission bypass
on SDK 0.16.4. Do not remove that regression or enable raw children to satisfy a
workflow requirement.

Ordinary tasks use `executionMode: "default"`; omission and `null` also select
ordinary execution. `"ultragoal-red-team"` requires the Executor role. Unused
control fields and optional repository metadata accept `null` for strict
provider schemas. Bindings are validated through the SDK's exported repository
contract before approval and again at child startup/resume; they do not select
a different child cwd. A different repository or escaping relative subdirectory
is rejected.

Children retain the actual parent model, effort, credentials, permissions and
tool allowlist. The direct owner's and root's native mutation/Ultragoal ask
guards also apply to child tool calls. Each child has a distinct session ID and
keeps GOAL disabled; the root adapter owns GOAL lifecycle and turn disposal.

The `gajae-app.delegation.v1` transcript entries record child ownership and
bounded result text. They are not native workflow completion receipts. Workflow
assignments must carry their authoritative owner `session_id`, `run_id` and
repository binding. Child prompts identify the app delegation ID, direct owner
and root, and instruct writers to use the assignment's owner/run IDs explicitly.

The offline tests in `server/gjc-delegation-executor.bun.test.ts` exercise SDK
0.16.4 public exports with real sessions, tools, transcripts and temporary Git
repositories. A deterministic transport stands in for the model; it asserts
`openai-codex/gpt-6-astra` with `xhigh` on every request and makes no network model
calls. They establish these contracts:

- Ralplan: Planner artifacts and independent Architect/Critic reads flow through
  `gjc ralplan --write`; native receipts bind the actual child IDs and hashes.
  Resumed lanes retain their IDs. Native overwrite and user-approval/Stop guards
  remain effective after the review passes.
- Ultragoal: independent lanes read a CLI fixture, execute it and provide real
  replay evidence. The owner joins their results and the Critic independently
  checks that join. Native validation rejects wrapper-only results, unjoined
  evidence and a false replay expectation. Only the native checkpoint writes
  the final aggregate completion receipt, verified by the durable-state guard.

These tests qualify the app-to-runtime contracts for the small fixtures; they
do not establish live model orchestration, product QA quality, browser E2E,
root GOAL lifecycle or packaged-app completion. Those require the parent
integration's live runs and repository promotion gate.
