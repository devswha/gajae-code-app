/**
 * Which of the runtime's builtin tools this app turns on.
 *
 * The tools are not built here — `@gajae-code/coding-agent` ships all 35 — so
 * the only decision the app makes is which ones a browser-hosted session
 * should have. It had been running on the SDK's six essentials plus `ask`,
 * which left capability the package already provides simply unreachable.
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

  // Structural code search. Read-only, and materially better than regex on
  // real refactors.
  'ast_grep',

  // Definitions, references and types. Degrades to nothing when the project
  // has no language server, so the downside is an unused tool.
  'lsp',

  // Resolves providers from the credentials already stored for this user and
  // returns a not-configured result when there are none.
  'web_search',
];

/**
 * Tools deliberately left off, with the reason. Written down because "absent"
 * and "not yet considered" look identical in a list, and the next person
 * widening this set needs to know which is which.
 */
export const GJC_AGENT_TOOLS_WITHHELD: Readonly<Record<string, string>> = {
  task: 'Delegates to sub-agents, so every call multiplies model spend. Wanted for the ralplan review loop, but that is a cost decision, not a default.',
  subagent: 'Same sub-agent spend as task.',
  job: 'Produces background work the app has no screen for; the /jobs surface tracks the app\u2019s own orchestrator, not this tool.',
  monitor: 'Long-lived watchers with nowhere to surface in the app.',
  cron: 'Schedules work that outlives the session with no UI to review or cancel it.',
  goal: 'Goal-mode artifacts accumulate as files the app cannot display. Enable together with a goals view.',
  browser: 'Spawns a real browser per call; heavy, and the app already runs in one.',
  computer: 'Controls the host desktop. Far outside what a chat session should reach, and invisible to a remote browser client.',
  ssh: 'Opens connections to other machines from a UI with no session-scoped confirmation for them.',
  telegram_send: 'Sends messages off this machine.',
  irc: 'Network chat unrelated to coding in this app.',
  checkpoint: 'Manipulates session state the app also owns; needs the two models reconciled first.',
  rewind: 'Same session-state overlap as checkpoint.',
};
