/**
 * Which runtime slash forms need confirmation before they run.
 *
 * The upstream registry carries no "destructive" marker — `SlashCommandSpec`
 * has `handle`, `aliases`, `allowArgs` and copy, nothing about consequence — so
 * this is app policy, and the app is where it belongs: a confirmation is a UI
 * affordance, not something the agent package can provide.
 *
 * Policy is an ALLOWLIST, not a denylist. Naming the dangerous forms would mean
 * that a command added by a future `@gajae-code/coding-agent` release runs
 * unconfirmed until someone notices — the same failure that let /move, /quit
 * and four other forms reach the model as prose. Naming the SAFE forms instead
 * makes an unrecognized form ask once. One is an annoyance, the other loses a
 * session.
 *
 * "Safe" here means: no data loss, no auth change, no effect outside this
 * machine, and no write to shared configuration. A session preference that is
 * visible immediately and trivially reversible (model, effort, fast mode,
 * session title) counts as safe — gating those would be pure friction.
 */

/** Commands whose every form is safe under that definition. */
const UNGATED_COMMANDS: ReadonlySet<string> = new Set([
  // Pure reads.
  '/dump',
  '/jobs',
  '/transcript',
  '/context',
  '/usage',
  '/changelog',
  '/tools',
  // Session preferences: visible at once, reversible by retyping.
  '/model',
  '/effort',
  '/fast',
  '/rename',
  // Writes one file the user explicitly asked for, contained to the project
  // by resolveContainedExportCommand.
  '/export',
  // A provider-bundled prompt, not a runtime command: it reaches the model,
  // which then writes AGENTS.md through the ordinary tool flow.
  '/init',
]);

/**
 * Safe forms of commands that also carry gated verbs. The empty verb is the
 * bare command, which upstream routes to that command's read-only default
 * (`/session` -> info, `/notify` -> status, `/memory` -> view, `/ssh` -> help,
 * `/provider` -> usage).
 */
const UNGATED_COMMAND_FORMS: ReadonlySet<string> = new Set([
  '/session',
  '/session info',
  '/notify',
  '/notify status',
  '/notify health',
  '/notify setup',
  '/memory',
  '/memory view',
  '/memory mm',
  '/ssh',
  '/ssh help',
  '/ssh list',
  '/provider',
  '/provider help',
  '/provider login',
]);

/** What the confirmation card tells the user is about to happen. */
const GATE_REASONS: Readonly<Record<string, string>> = {
  '/clear': 'Clears this conversation\u2019s context. The transcript stays, the agent\u2019s working memory does not.',
  '/compact': 'Rewrites the conversation into a summary. The original turns are not recoverable afterwards.',
  '/handoff': 'Writes a handoff document and moves you to a new session.',
  '/session delete': 'Deletes this session and its transcript. This cannot be undone.',
  '/memory clear': 'Erases stored memory.',
  '/memory reset': 'Erases stored memory.',
  '/memory enqueue': 'Queues a memory rebuild, which rewrites stored memory.',
  '/memory rebuild': 'Queues a memory rebuild, which rewrites stored memory.',
  '/login': 'Starts an authentication flow that changes the credentials this machine uses.',
  '/logout': 'Signs out. Other sessions on this machine lose access too.',
  '/notify test': 'Sends a real notification to your configured transport.',
  '/notify recovery': 'Clears notification locks and endpoint files.',
  '/ssh add': 'Writes an SSH host into shared configuration, outside this project.',
  '/ssh remove': 'Removes an SSH host from shared configuration, outside this project.',
  '/ssh rm': 'Removes an SSH host from shared configuration, outside this project.',
  '/provider add': 'Writes provider credentials into shared configuration, outside this project.',
  '/contribute-pr': 'Dumps this session\u2019s context and starts a separate worker process.',
};

/**
 * The prefix every skill invocation carries.
 *
 * Skills are matched by prefix rather than by name because the bundled four
 * are not the whole set: `/api/providers/gjc/skills` also returns project- and
 * user-scoped skills discovered at runtime, and an override can shadow a
 * bundled name. A name list here would advertise those in the slash menu and
 * then confirm them with the unclassified copy, which tells the user the app
 * does not recognize a command it just offered.
 */
const SKILL_COMMAND_PREFIX = '/skill:';

const skillGateReason = (skillName: string): string =>
  `Runs the \`${skillName}\` skill: a multi-step workflow that keeps working on its own and can read and write files across this project.`;

/** Shown when the app has no entry for the form at all. */
export const UNCLASSIFIED_GATE_REASON =
  'The app has not classified this command, so it is asking first. Check what it does before running it.';

export type CommandGate = {
  /** Stable id for the gated form, used as the confirmation card key. */
  gateId: string;
  /** One sentence describing the consequence. */
  summary: string;
  /** True when the app recognizes the form; false is the fail-closed default. */
  classified: boolean;
};

const verbOf = (args: string): string => args.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';

/**
 * Returns the confirmation a runtime slash form needs, or null when it may run
 * directly. Skills are never in the allowlist, so `/skill:<name>` always gates.
 */
export function gateForCommand(commandName: string, args = ''): CommandGate | null {
  if (UNGATED_COMMANDS.has(commandName)) return null;

  const verb = verbOf(args);
  const form = verb ? `${commandName} ${verb}` : commandName;
  if (UNGATED_COMMAND_FORMS.has(form)) return null;

  // The id names whichever entry matched, so a command-level reason keys the
  // card by the command rather than by whatever arguments were typed.
  const formReason = GATE_REASONS[form];
  if (formReason) return { gateId: form, summary: formReason, classified: true };

  const commandReason = GATE_REASONS[commandName];
  if (commandReason) return { gateId: commandName, summary: commandReason, classified: true };

  // Keyed by the skill, not the form, so `/skill:ralplan --deliberate` and the
  // bare invocation share one confirmation card.
  const skillName = commandName.startsWith(SKILL_COMMAND_PREFIX)
    ? commandName.slice(SKILL_COMMAND_PREFIX.length)
    : '';
  if (skillName) {
    return { gateId: commandName, summary: skillGateReason(skillName), classified: true };
  }

  return { gateId: form, summary: UNCLASSIFIED_GATE_REASON, classified: false };
}

/** Exposed for the drift test that checks these names still exist upstream. */
export const UNGATED_COMMAND_NAMES: readonly string[] = [
  ...UNGATED_COMMANDS,
  ...[...UNGATED_COMMAND_FORMS].map((form) => form.split(' ')[0] as string),
];
