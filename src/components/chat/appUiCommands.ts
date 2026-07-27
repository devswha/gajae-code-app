/**
 * App-level slash commands.
 *
 * GJC's TUI ships slash commands (e.g. /resume, /sessions, /new) that only
 * drive terminal UI — they have no headless text-runtime handler, so the
 * server-side catalog (server/modules/providers/gjc-command-catalog.ts) can
 * never dispatch them through the Bun worker. This registry gives those
 * commands app-native equivalents instead: each entry appears in the slash
 * menu and, when selected or typed, runs a local UI action rather than being
 * forwarded to the model.
 *
 * To add another one: add an action id + registry entry here and wire the
 * action in the `AppUiCommandActions` implementor (useChatComposerState).
 * App entries take precedence over same-named server commands in the menu.
 *
 * TUI-only commands with no sensible app affordance get a typed-input notice
 * (TUI_ONLY_COMMAND_NOTICES) so they are not silently sent to the model as
 * plain prompts.
 */

export type AppUiCommandActionId =
  | 'open-session-picker'
  | 'start-new-chat'
  | 'open-settings'
  | 'open-model-picker';

export type AppUiCommand = {
  name: string;
  description: string;
  namespace: 'app';
  type: 'app';
  actionId: AppUiCommandActionId;
  /**
   * When false, a typed invocation WITH arguments (e.g. "/model gpt-x") is
   * not intercepted and flows to the provider text runtime instead, mirroring
   * the TUI where the bare command opens a selector but arguments act
   * directly.
   */
  interceptWithArgs?: boolean;
};

export type AppUiCommandActions = {
  openSessionPicker: () => void;
  startNewChat: () => void;
  openSettings: () => void;
  openModelPicker: () => void;
};

export const APP_UI_COMMANDS: readonly AppUiCommand[] = [
  {
    name: '/resume',
    description: 'Resume a previous session (opens the session picker)',
    namespace: 'app',
    type: 'app',
    actionId: 'open-session-picker',
  },
  {
    name: '/sessions',
    description: "Browse this project's sessions",
    namespace: 'app',
    type: 'app',
    actionId: 'open-session-picker',
  },
  {
    name: '/new',
    description: 'Start a new session',
    namespace: 'app',
    type: 'app',
    actionId: 'start-new-chat',
  },
  {
    name: '/settings',
    description: 'Open app settings',
    namespace: 'app',
    type: 'app',
    actionId: 'open-settings',
  },
  {
    name: '/model',
    description: 'Choose the model preset (opens the model picker)',
    namespace: 'app',
    type: 'app',
    actionId: 'open-model-picker',
    interceptWithArgs: false,
  },
];

const APP_UI_COMMANDS_BY_NAME = new Map(
  APP_UI_COMMANDS.map((command) => [command.name, command]),
);

export const findAppUiCommand = (commandName: string): AppUiCommand | undefined =>
  APP_UI_COMMANDS_BY_NAME.get(commandName);

export const isAppUiCommand = (command: { type?: unknown }): boolean =>
  command.type === 'app';

export function runAppUiCommand(command: AppUiCommand, actions: AppUiCommandActions): void {
  switch (command.actionId) {
    case 'open-session-picker':
      actions.openSessionPicker();
      break;
    case 'start-new-chat':
      actions.startNewChat();
      break;
    case 'open-settings':
      actions.openSettings();
      break;
    case 'open-model-picker':
      actions.openModelPicker();
      break;
  }
}

/**
 * Runtime command aliases, mirroring `aliases` in the upstream builtin
 * registry. The composer resolves these before looking anything up, so an
 * alias behaves exactly like the name it stands for instead of falling
 * through to the model as prose.
 *
 * `/models` and `/contribution-prep` also resolve server-side (see
 * GJC_APP_BUILTIN_COMMAND_ALIASES) because their canonical commands have text
 * handlers; resolving here as well is what makes bare `/models` open the model
 * picker rather than printing a text summary.
 */
export const RUNTIME_COMMAND_ALIASES: Readonly<Record<string, string>> = {
  '/models': '/model',
  '/contribution-prep': '/contribute-pr',
  '/bg': '/background',
  '/quit': '/exit',
};

export function resolveCommandAlias(commandName: string): string {
  return RUNTIME_COMMAND_ALIASES[commandName] ?? commandName;
}

/**
 * GJC TUI-only commands with no app equivalent. Typing one gets a local
 * notice instead of being silently forwarded to the model as a plain prompt.
 * Values are optional extra hints appended to the generic notice.
 */
export const TUI_ONLY_COMMAND_HINTS: Readonly<Record<string, string>> = {
  '/retry': 'To follow up on an interrupted run, open the session and send a new message.',
  '/goal': '',
  '/agents': '',
  '/monitors': '',
  '/tree': '',
  '/background': 'App sessions already keep running when you navigate away.',
  '/debug': '',
  '/copy': '',
  '/btw': '',
  '/drop': '',
  '/hotkeys': '',
  '/theme': 'Use the command palette (Cmd/Ctrl+K) to toggle the theme.',
  '/pet': '',
  '/exit': '',
  '/help': 'Type "/" to browse every command available here.',
};

export function getTuiOnlyCommandNotice(commandName: string): string | null {
  const hint = TUI_ONLY_COMMAND_HINTS[commandName];
  if (hint === undefined) return null;
  const base = `\`${commandName}\` is a GJC terminal (TUI) command and is not available in the app.`;
  return hint ? `${base} ${hint}` : base;
}

/**
 * Commands and command FORMS the app answers itself rather than dispatching.
 *
 * `/move` has a runtime handler, but it retargets the session's working
 * directory; in the app a session is bound to the project you picked, so
 * moving it out from under that selection leaves the sidebar, the file tree
 * and the worker pointing at different places.
 *
 * `/notify on|off` is the one form of `/notify` the upstream builtin does not
 * consume — it returns the text as a residual prompt so GJC's notifications
 * extension can own the session-local toggle for its terminal/Telegram daemon.
 * The app runs its own notification stack (server/modules/notifications) and
 * opts out of that daemon, so with no consumer the residual reached the model
 * as prose. Every other `/notify` verb is consumed upstream and still
 * dispatches normally.
 *
 * Keys are either a command name or "<command> <verb>"; the more specific form
 * wins.
 */
export const APP_UNSUPPORTED_COMMAND_HINTS: Readonly<Record<string, string>> = {
  '/move': 'Sessions follow the project you select — switch projects from the sidebar instead.',
  '/notify on': 'The app delivers its own notifications — manage them in Settings → Notifications.',
  '/notify off': 'The app delivers its own notifications — manage them in Settings → Notifications.',
  '/skill:team': 'It drives workers through tmux panes, which this app cannot show. Run `gjc` in a terminal for that, or use `/skill:ultragoal` here.',
};

export function getAppUnsupportedCommandNotice(commandForm: string): string | null {
  const hint = APP_UNSUPPORTED_COMMAND_HINTS[commandForm];
  if (hint === undefined) return null;
  const base = `\`${commandForm}\` is not available in the app.`;
  return hint ? `${base} ${hint}` : base;
}

/**
 * The single local-notice lookup both `chat.send` producers use. Resolves the
 * alias first so `/quit` answers as `/exit` does, then prefers a form-level
 * decline (`/notify on`) over a command-level one.
 */
export function getLocalCommandNotice(commandName: string, args = ''): string | null {
  const canonical = resolveCommandAlias(commandName);
  const verb = args.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return (verb ? getAppUnsupportedCommandNotice(`${canonical} ${verb}`) : null)
    ?? getTuiOnlyCommandNotice(canonical)
    ?? getAppUnsupportedCommandNotice(canonical);
}

/**
 * Whether the slash menu should advertise this command.
 *
 * The menu and the typed-input path share one rule: anything the app answers
 * with a local "not available" notice is not offered in the menu either.
 * Keeping both off `getLocalCommandNotice` means a single map edit moves a
 * command in or out of the app's supported surface, and the two can never
 * disagree about what the app supports.
 */
export function isAppUsableCommand(commandName: string): boolean {
  return getLocalCommandNotice(commandName) === null;
}
