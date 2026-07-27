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
};

export function getTuiOnlyCommandNotice(commandName: string): string | null {
  const hint = TUI_ONLY_COMMAND_HINTS[commandName];
  if (hint === undefined) return null;
  const base = `\`${commandName}\` is a GJC terminal (TUI) command and is not available in the app.`;
  return hint ? `${base} ${hint}` : base;
}
