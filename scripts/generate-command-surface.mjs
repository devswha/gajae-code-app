#!/usr/bin/env node
/**
 * Generates the app's view of the GJC command surface from the installed
 * runtime, instead of keeping a hand-typed copy of it.
 *
 * The copy is what broke. `gjc-command-catalog.ts` listed 23 command names
 * somebody typed out, and nothing compared that list to the package. When a
 * name was missing the app simply did not recognize the command and forwarded
 * the raw text to the model as a prompt — which is how /move, /models, /bg,
 * /quit, /contribution-prep and /help ended up reaching the model as prose.
 * `docs/UPSTREAM.md` takes upstream changes by manual intake only, so nothing
 * would have corrected that on the next version bump either.
 *
 * Inverting it is the fix: derive the list, and hand-maintain only the
 * EXCLUSIONS and ADDITIONS, each with a reason. A command added upstream then
 * appears automatically rather than needing anyone to notice it.
 *
 * The runtime cannot be imported from node — `@gajae-code/coding-agent` pulls
 * in `bun:*` builtins — so the data is read out through the bundled bun and
 * emitted as plain TypeScript the API server can import.
 *
 * Default mode verifies and fails on drift; `--update` rewrites the file.
 */
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import matter from 'gray-matter';

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const bunPath = path.join(rootDir, 'dist-native', process.platform === 'win32' ? 'bun.exe' : 'bun');
const outputPath = path.join(rootDir, 'server', 'modules', 'providers', 'gjc-command-surface.generated.ts');
const update = process.argv.slice(2).includes('--update');

if (process.argv.slice(2).some((argument) => argument !== '--update')) {
  throw new Error('Usage: node scripts/generate-command-surface.mjs [--update]');
}

/**
 * Text builtins the app deliberately does not dispatch. Every entry needs a
 * reason: an unexplained exclusion is indistinguishable from a command that
 * was dropped by accident, which is the failure this generator exists to stop.
 */
const EXCLUDED = {
  move: 'Retargets the session working directory, which desyncs the app-owned project binding. Answered by a local notice instead.',
};

/**
 * Commands the app dispatches that the runtime does not advertise as text
 * builtins. `/login` and `/logout` are TUI-only upstream; the app claims them
 * so the desktop returns actionable guidance rather than forwarding the slash
 * command to the model.
 */
const ADDED = [
  { name: 'login', description: 'Login with OAuth provider', inputHint: '[provider|redirect URL]' },
  { name: 'logout', description: 'Logout from OAuth provider', inputHint: '[provider]' },
];

/**
 * Runtime aliases that resolve to a dispatched command upstream. Dispatchable
 * but not advertised, so the menu shows the canonical name only. Aliases of
 * TUI-only commands (bg, quit) are absent on purpose: their specs have no text
 * handler, so dispatching them would fall through to the model again.
 */
const ALIASES = {
  models: 'model',
  'contribution-prep': 'contribute-pr',
};

/**
 * The bundled skills live as plain markdown inside the package, but
 * `BUNDLED_SKILLS` is not exported, so the app kept a transcribed copy of every
 * name and description. A description edited upstream left the app advertising
 * the old wording indefinitely. Read the frontmatter instead — this part needs
 * no bun, the files are ordinary markdown.
 */
const skillsDir = path.join(
  rootDir,
  'node_modules/@gajae-code/coding-agent/src/defaults/gjc/skills',
);

async function readBundledSkills() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = await fs.readFile(path.join(skillsDir, entry.name, 'SKILL.md'), 'utf8');
    const { data } = matter(source);
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : entry.name;
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    if (!description) throw new Error(`Bundled skill ${entry.name} has no description.`);
    skills.push({ name, description });
  }
  if (skills.length === 0) {
    throw new Error('No bundled skills found; refusing to generate an empty list.');
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function readRuntimeSurface() {
  const source = `
    const { ACP_BUILTIN_SLASH_COMMANDS } = await import('@gajae-code/coding-agent/slash-commands/acp-builtins');
    console.log(JSON.stringify({
      commands: ACP_BUILTIN_SLASH_COMMANDS.map((command) => ({
        name: command.name,
        description: command.description,
        inputHint: command.input?.hint,
      })),
    }));
  `;
  const { stdout } = await execFile(bunPath, ['--eval', source], { cwd: rootDir });
  const payload = JSON.parse(stdout.trim().split('\n').at(-1));
  if (!Array.isArray(payload.commands) || payload.commands.length === 0) {
    throw new Error('The runtime reported no text builtins; refusing to generate an empty surface.');
  }
  return payload;
}

function render({ commands, skills }) {
  const kept = commands.filter((command) => !(command.name in EXCLUDED));
  const missing = Object.keys(EXCLUDED).filter(
    (name) => !commands.some((command) => command.name === name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Excluded commands no longer exist upstream: ${missing.join(', ')}. `
      + 'Drop the stale entries from EXCLUDED in scripts/generate-command-surface.mjs.',
    );
  }

  const entries = [...kept, ...ADDED].map((command) => {
    const hint = command.inputHint ? `, inputHint: ${JSON.stringify(command.inputHint)}` : '';
    return `  { name: ${JSON.stringify(command.name)}, description: ${JSON.stringify(command.description)}${hint} },`;
  });

  const excluded = Object.entries(EXCLUDED)
    .map(([name, reason]) => `//   ${name}: ${reason}`)
    .join('\n');
  const skillEntries = skills.map(
    (skill) => `  { name: ${JSON.stringify(skill.name)}, description: ${JSON.stringify(skill.description)} },`,
  );
  const aliases = Object.entries(ALIASES)
    .map(([alias, canonical]) => `  ${JSON.stringify(alias)}: ${JSON.stringify(canonical)},`)
    .join('\n');

  return `// GENERATED by scripts/generate-command-surface.mjs — do not edit.
// Run \`npm run generate:command-surface -- --update\` after a runtime bump.
//
// Derived from ACP_BUILTIN_SLASH_COMMANDS in the installed
// @gajae-code/coding-agent. Anything the runtime advertises appears here
// automatically; only the exclusions and additions below are hand-maintained.
//
// Excluded text builtins:
${excluded}

export type GjcAppCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

export const GJC_APP_BUILTIN_COMMANDS: readonly GjcAppCommand[] = [
${entries.join('\n')}
];

/** Aliases the adapter dispatches without advertising them in the menu. */
export const GJC_APP_BUILTIN_COMMAND_ALIASES: Readonly<Record<string, string>> = {
${aliases}
};

export const GJC_APP_BUILTIN_COMMAND_NAMES = new Set([
  ...GJC_APP_BUILTIN_COMMANDS.map((command) => command.name),
  ...Object.keys(GJC_APP_BUILTIN_COMMAND_ALIASES),
]);

/**
 * Bundled workflow skills, read from each SKILL.md frontmatter in the installed
 * runtime. Descriptions therefore match what the runtime actually ships.
 */
export const GJC_BUNDLED_SKILLS: readonly { name: string; description: string }[] = [
${skillEntries.join('\n')}
];
`;
}

const generated = render({
  ...(await readRuntimeSurface()),
  skills: await readBundledSkills(),
});
const existing = await fs.readFile(outputPath, 'utf8').catch(() => null);

if (!update) {
  if (existing !== generated) {
    console.error(
      'GJC command surface is stale; run `npm run generate:command-surface -- --update`.',
    );
    process.exitCode = 1;
  } else {
    console.log('Verified GJC command surface against the installed runtime.');
  }
} else {
  if (existing !== generated) await fs.writeFile(outputPath, generated);
  console.log(`${existing === generated ? 'Verified' : 'Updated'} GJC command surface.`);
}
