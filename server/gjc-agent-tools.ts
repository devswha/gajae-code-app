/**
 * Which of the runtime's builtin tools this app turns on.
 *
 * `@gajae-code/coding-agent` owns the builtin registry. The adapter substitutes
 * app-owned task/subagent implementations and automation transports for the
 * selected names. Every current registry entry must appear in exactly one
 * list below; the partition test makes an upstream addition deliberate.
 *
 * An allowlist is right here, unlike the command catalog: a tool carries real
 * cost or reach (extra model calls, a spawned browser, an SSH connection, a
 * message leaving the machine), so silence should mean off. The drift test
 * covers the other direction — a name that stops existing upstream fails
 * loudly instead of being quietly dropped.
 *
 * Enabling a tool whose output has nowhere to appear is only half an enable,
 * so each entry below is one the app can already show: every tool call renders
 * through the chat's tool card, including via the Default config.
 */
export const GJC_AGENT_TOOL_NAMES: readonly string[] = [
  // Core coding loop, unchanged.
  'bash',
  'read',
  'write',
  'edit',
  'search',
  'find',
  // Lets the agent ask a question mid-turn; the composer already renders the
  // permission/question panel for it. The adapter appends this anyway.
  'ask',

  // Loads a SKILL.md into the turn and seeds workflow state. Without it the
  // app advertises the bundled skills in the slash menu while `/skill:<name>`
  // reaches the model as bare text, so the three usable ones never really
  // activate. The slash-to-skill path itself is TUI-only, so this tool is how
  // a browser session invokes them at all.
  'skill',

  // Task tracking across a long turn. Pure bookkeeping, no reach outside the
  // session, and it makes multi-step work legible in the transcript.
  'todo_write',

  // The adapter replaces these names through the public CustomTool API and
  // excludes the SDK builtins. App children inherit policy/model/credentials,
  // remain owned by their calling transcript and end with the owner's turn.
  'task',
  'subagent',

  // Structural code search. Read-only, and materially better than regex on
  // real refactors.
  'ast_grep',

  // Executes a named project-runner task through the same BashTool result
  // shape, which the generic tool card already renders. It is explicit rather
  // than arriving incidentally from recipe.enabled when bash is present.
  'recipe',

  // Definitions, references and types. Degrades to nothing when the project
  // has no language server, so the downside is an unused tool.
  'lsp',

  // Resolves providers from the credentials already stored for this user and
  // returns a not-configured result when there are none.
  'web_search',

  // App-owned automation transports replace the SDK defaults, so the agent
  // and the visible Workspace Browser operate the same Chromium session while
  // native application actions stay behind CUA Driver.
  'browser',
  'computer',
];

/**
 * Tools deliberately left off, with the reason. Written down because "absent"
 * and "not yet considered" look identical in a list, and the next person
 * widening this set needs to know which is which.
 */
export const GJC_AGENT_TOOLS_WITHHELD: Readonly<Record<string, string>> = {
  job: 'Produces background work the app has no screen for; the /jobs surface tracks the app\u2019s own orchestrator, not this tool.',
  monitor: 'Long-lived watchers with nowhere to surface in the app.',
  cron: 'Schedules work that outlives the session with no UI to review or cancel it.',
  goal: 'Enabled conditionally by the SDK adapter for a capable app view with scoped lifecycle controls and bounded continuation; excluded from delegated sessions and clients without controls.',
  ssh: 'Opens connections to other machines from a UI with no session-scoped confirmation for them.',
  telegram_send: 'Sends messages off this machine.',
  irc: 'Network chat unrelated to coding in this app.',
  ast_edit: 'Produces only a preview and requires hidden resolve to apply it; resolve is not requestable through toolNames, so browser edits would be permanently pending.',
  render_mermaid: 'A future candidate, but its ASCII artifact needs a diagram/artifact card before it is useful as more than raw tool output.',
  debug: 'A future candidate, but launch, attach, memory, and process control need a debugger panel and an explicit permission boundary first.',
  bisect: 'Its cleanup uses git reset --hard on tracked predicate edits, which is too destructive for an agent-callable browser default.',
  eval: 'Overlaps the persistent python kernel; exposing both competing code-execution concepts would be a product mistake.',
  python: 'Overlaps the in-process eval backend; expose one deliberate code-execution surface rather than two competing persistent-kernel concepts.',
  calc: 'Simple arithmetic does not justify another tool surface while the model can calculate or use a deliberate code-execution tool.',
  github: 'A future candidate, but GitHub reads and PR creation/push need a dedicated card and repository/network permission boundary first.',
  search_tool_bm25: 'Activates arbitrary hidden tools at runtime, defeating this allowlist until the app owns discoverableToolAllowedNames.',
  skill_discovery: 'The app already advertises its supported skills; exposing raw discovery needs a UI for discovered metadata and activation decisions.',
  move_session: 'Permanently repoints the SDK session cwd, contradicting the app’s stable project/session binding and its excluded /move command.',
  checkpoint: 'Manipulates session state the app also owns; needs the two models reconciled first.',
  rewind: 'Same session-state overlap as checkpoint.',
};
