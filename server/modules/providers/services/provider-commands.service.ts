import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import { GJC_APP_BUILTIN_COMMANDS } from '@/modules/providers/gjc-command-surface.generated.js';
import { projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

export type ProviderCommand = {
  name: string;
  description: string;
  namespace: 'builtin' | 'project' | 'user' | 'bundled';
  type: 'provider';
  path?: string;
  metadata?: Record<string, unknown>;
};

type ProviderCommandsDependencies = {
  homeDir?: string;
  resolveProjectPath?: (projectId: string) => string | null;
};

const bundledCommands: readonly ProviderCommand[] = [
  {
    name: '/init',
    description: 'Generate AGENTS.md for current codebase',
    namespace: 'bundled',
    type: 'provider',
  },
];

async function scanCommandDirectory(
  directory: string,
  namespace: 'project' | 'user',
  relativeDirectory = directory,
): Promise<ProviderCommand[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const commands: ProviderCommand[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      commands.push(...await scanCommandDirectory(entryPath, namespace, relativeDirectory));
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name) !== '.md') continue;

    try {
      const parsed = matter(await readFile(entryPath, 'utf8'));
      const relativeName = path.relative(relativeDirectory, entryPath).replace(/\\/g, '/').replace(/\.md$/, '');
      const firstContentLine = parsed.content.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
      const description = typeof parsed.data.description === 'string' && parsed.data.description.trim()
        ? parsed.data.description.trim()
        : firstContentLine.replace(/^#+\s*/, '').slice(0, 160);
      if (!relativeName || !description) continue;

      commands.push({
        name: `/${relativeName}`,
        description,
        namespace,
        type: 'provider',
        path: entryPath,
        metadata: parsed.data as Record<string, unknown>,
      });
    } catch {
      // Invalid command files are omitted, matching GJC's fail-soft discovery.
    }
  }

  return commands;
}

export const createProviderCommandsService = (dependencies: ProviderCommandsDependencies = {}) => {
  const homeDir = dependencies.homeDir ?? os.homedir();
  const resolveProjectPath = dependencies.resolveProjectPath ?? projectsDb.getProjectPathById;

  return {
    async listProviderCommands(projectId?: string): Promise<ProviderCommand[]> {
      const workspacePath = projectId ? resolveProjectPath(projectId) : null;
      if (projectId && !workspacePath) {
        throw new AppError(`Project "${projectId}" was not found.`, {
          code: 'PROJECT_NOT_FOUND',
          statusCode: 404,
        });
      }

      const projectCommands = workspacePath
        ? await scanCommandDirectory(path.join(workspacePath, '.gjc', 'commands'), 'project')
        : [];
      const userCommands = await scanCommandDirectory(
        path.join(homeDir, '.gjc', 'agent', 'commands'),
        'user',
      );
      const builtins = GJC_APP_BUILTIN_COMMANDS.map((command): ProviderCommand => ({
        name: `/${command.name}`,
        description: command.description,
        namespace: 'builtin',
        type: 'provider',
        metadata: command.inputHint ? { inputHint: command.inputHint } : undefined,
      }));
      const commandsByName = new Map<string, ProviderCommand>();

      // Match GJC precedence: project, user, bundled prompt, then built-in.
      for (const command of [...projectCommands, ...userCommands, ...bundledCommands, ...builtins]) {
        if (!commandsByName.has(command.name)) commandsByName.set(command.name, command);
      }

      return [...commandsByName.values()];
    },
  };
};

export const providerCommandsService = createProviderCommandsService();
