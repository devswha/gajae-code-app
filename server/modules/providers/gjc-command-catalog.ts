export type GjcAppCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

/**
 * Commands supported directly by GJC's text runtime, plus the canonical
 * login/logout aliases whose desktop behavior returns actionable terminal
 * guidance instead of incorrectly forwarding the slash command to the model.
 */
export const GJC_APP_BUILTIN_COMMANDS: readonly GjcAppCommand[] = [
  { name: 'notify', description: 'Notification status, health, test, recovery, and session on/off', inputHint: '[on|off|status|health|test|recovery|setup]' },
  { name: 'model', description: 'Show current model selection', inputHint: '[target] <model>' },
  { name: 'effort', description: 'Show or set model reasoning effort', inputHint: '[inherit|off|minimal|low|medium|high|xhigh|max]' },
  { name: 'fast', description: 'Toggle fast mode', inputHint: '[on|off|status]' },
  { name: 'export', description: 'Export this session to an HTML file', inputHint: '[path]' },
  { name: 'dump', description: 'Return full transcript as plain text' },
  { name: 'session', description: 'Show session information', inputHint: 'info|delete' },
  { name: 'jobs', description: 'Show background jobs' },
  { name: 'transcript', description: 'Browse the current session transcript' },
  { name: 'context', description: 'Show active context token usage breakdown' },
  { name: 'usage', description: 'Show token usage' },
  { name: 'changelog', description: 'Show release notes and changelog entries', inputHint: '[full|--full]' },
  { name: 'tools', description: 'Show available tools' },
  { name: 'provider', description: 'Set up API-compatible providers or login providers', inputHint: 'add|login' },
  { name: 'login', description: 'Login with OAuth provider', inputHint: '[provider|redirect URL]' },
  { name: 'logout', description: 'Logout from OAuth provider', inputHint: '[provider]' },
  { name: 'ssh', description: 'Manage SSH connections', inputHint: '<subcommand>' },
  { name: 'clear', description: 'Clear context while preserving this session ID' },
  { name: 'compact', description: 'Compact the conversation', inputHint: '[focus instructions]' },
  { name: 'handoff', description: 'Generate a handoff document and start a new session', inputHint: '[focus instructions]' },
  { name: 'contribute-pr', description: 'Dump redacted session context and spawn a fresh contribute-pr worker', inputHint: '[focus instructions]' },
  { name: 'memory', description: 'Manage memory', inputHint: '<subcommand>' },
  { name: 'rename', description: 'Rename the current session', inputHint: '<title>' },
];

/**
 * Runtime aliases that resolve to a catalog command upstream.
 *
 * `lookupBuiltinSlashCommand` maps each alias onto the canonical spec, so the
 * handler exists — only this app's dispatch gate was missing them, which sent
 * the raw text to the model as a prompt instead. They are dispatchable but not
 * advertised: the slash menu lists the canonical name alone.
 *
 * Aliases of TUI-only commands (`bg` -> `background`, `quit` -> `exit`) are
 * deliberately absent. Those specs have no text handler, so dispatching them
 * would fall through to the model again; the app answers them with a local
 * notice instead.
 */
export const GJC_APP_BUILTIN_COMMAND_ALIASES: Readonly<Record<string, string>> = {
  models: 'model',
  'contribution-prep': 'contribute-pr',
};

export const GJC_APP_BUILTIN_COMMAND_NAMES = new Set([
  ...GJC_APP_BUILTIN_COMMANDS.map((command) => command.name),
  ...Object.keys(GJC_APP_BUILTIN_COMMAND_ALIASES),
]);
