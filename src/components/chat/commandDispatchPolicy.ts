import {
  findAppUiCommand,
  getLocalCommandNotice,
  resolveCommandAlias,
  type AppUiCommand,
} from './appUiCommands';

/**
 * Shared pre-dispatch classification for composer input.
 *
 * There are two producers of `chat.send`: the composer (`useChatComposerState`)
 * and the app-level auto-send for sessions that finish while the user is
 * looking elsewhere (`useQueuedMessageAutoSend`). Only the composer used to
 * classify slash commands, and it does so AFTER the in-flight-turn stash — so a
 * slash command typed during a run was persisted as a plain draft and later
 * dispatched by the auto-send hook as raw text, skipping interception entirely.
 *
 * This module holds the rule both producers consult. It is intentionally pure:
 * it decides *what a text would do*, never does it. Acting on an `app-action`
 * or a `notice` requires the owning session's UI, which is why the queued
 * producer may only act on `allow`.
 */

export type CommandDisposition =
  /** Plain prose. Safe to send from any producer. */
  | { kind: 'allow' }
  /** Runs a local UI action; requires the owning session to be on screen. */
  | { kind: 'app-action'; commandName: string; command: AppUiCommand }
  /** Renders a local message; requires the owning session's message list. */
  | { kind: 'notice'; commandName: string; text: string }
  /**
   * A slash form that reaches the runtime, including unrecognized ones. Some
   * are destructive (`/clear`, `/session delete`, `/ssh rm`) and the app has no
   * confirmation surface outside the composer, so this is never auto-sendable.
   */
  | { kind: 'command'; commandName: string };

/**
 * Mirrors the composer's interception test: a leading "/" after trailing
 * whitespace is trimmed, plus the bare "help" convenience alias.
 */
export function parseCommandName(text: string): { commandName: string; args: string } | null {
  const commandInput = text.trimEnd();
  const isHelpAlias = commandInput.trim().toLowerCase() === 'help';
  if (!commandInput.startsWith('/') && !isHelpAlias) return null;

  const firstSpace = commandInput.indexOf(' ');
  const commandName = isHelpAlias
    ? '/help'
    : firstSpace > 0 ? commandInput.slice(0, firstSpace) : commandInput;
  const args = firstSpace > 0 && !isHelpAlias ? commandInput.slice(firstSpace).trim() : '';
  return { commandName, args };
}

/**
 * Classifies composer input without acting on it.
 *
 * Fail-closed: anything that parses as a slash form and is not positively an
 * app action or a notice resolves to `command`, so an unknown or newly added
 * slash name is withheld from the queued producer rather than dispatched blind.
 */
export function classifyCommandInput(text: string): CommandDisposition {
  const parsed = parseCommandName(text);
  if (!parsed) return { kind: 'allow' };

  const { commandName, args } = parsed;

  // `interceptWithArgs: false` (e.g. /model) only claims the bare form; the
  // argument form belongs to the text runtime, matching the composer. Aliases
  // resolve first so `/models` classifies exactly as `/model` does.
  const command = findAppUiCommand(resolveCommandAlias(commandName));
  if (command && (command.interceptWithArgs !== false || !args)) {
    return { kind: 'app-action', commandName, command };
  }

  const notice = getLocalCommandNotice(commandName, args);
  if (notice) return { kind: 'notice', commandName, text: notice };

  return { kind: 'command', commandName };
}

/**
 * Whether a producer with no session UI attached may dispatch this text.
 *
 * Only plain prose qualifies. Every slash disposition needs the owning
 * session's composer: an app action drives that session's UI, a notice renders
 * into its message list, and a runtime command may be destructive with no gate
 * on this path.
 */
export function isAutoSendable(disposition: CommandDisposition): boolean {
  return disposition.kind === 'allow';
}
