/**
 * Which of the runtime's builtin tools an app session requests.
 *
 * `@gajae-code/coding-agent` owns the builtin registry, and an app session gets
 * what the GJC CLI gets: every builtin is requested, and each one's own
 * availability rule - the user's `~/.gjc` settings (`calc.enabled`,
 * `github.enabled`, `checkpoint.enabled`, ...), a configured SSH host, a
 * reachable Python kernel - decides whether it materializes, exactly as it
 * does in a CLI session. The adapter substitutes app-owned task/subagent
 * implementations and automation transports for the selected names.
 *
 * Every current registry entry must appear in exactly one list below; the
 * partition test makes an upstream addition deliberate. A tool is withheld
 * only when the app's hosting model cannot carry it, never to make the app
 * narrower than the CLI.
 */
export const GJC_AGENT_TOOL_NAMES: readonly string[] = [
  'bash',
  'read',
  'write',
  'edit',
  'search',
  'find',
  'ask',
  'skill',
  'skill_discovery',
  'search_tool_bm25',
  'todo_write',
  // The adapter replaces these names through the public CustomTool API and
  // excludes the SDK builtins. App children inherit policy/model/credentials,
  // remain owned by their calling transcript and end with the owner's turn.
  'task',
  'subagent',
  'ast_grep',
  'ast_edit',
  'recipe',
  'lsp',
  'web_search',
  'eval',
  'python',
  'calc',
  'debug',
  'bisect',
  'render_mermaid',
  'github',
  'ssh',
  'irc',
  'telegram_send',
  'checkpoint',
  'rewind',
  // App-owned automation transports replace the SDK defaults where the app
  // has them; otherwise the runtime's own implementation runs, as in the CLI.
  'browser',
  'computer',
  // Hidden companion of preview tools (ast_edit): applies or discards a pending
  // preview. The CLI requests it implicitly by requesting every tool.
  'resolve',
];

/**
 * Tools the app's hosting model cannot carry, with the reason. Written down
 * because "absent" and "not yet considered" look identical in a list.
 */
export const GJC_AGENT_TOOLS_WITHHELD: Readonly<Record<string, string>> = {
  job: 'The app disposes the SDK session when each turn ends, so a background job is torn down with it and can never deliver its result into a later turn the way it does in a long-lived CLI session.',
  monitor: 'A monitor watches a background process past the turn; the app disposes the SDK session when each turn ends, so it would stop before it could report.',
  cron: 'Scheduled prompts fire into a live session; the app disposes the SDK session when each turn ends, so a schedule would never fire.',
  goal: 'Enabled conditionally by the SDK adapter for a capable app view with scoped lifecycle controls and bounded continuation; excluded from delegated sessions and clients without controls.',
  move_session: 'Permanently repoints the SDK session cwd, which the app binds to the session\u2019s project; the /move command is excluded for the same reason.',
};
