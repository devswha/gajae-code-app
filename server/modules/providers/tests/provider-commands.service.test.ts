import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GJC_APP_BUILTIN_COMMANDS } from '@/gjc-engine.js';
import { createProviderCommandsService } from '@/modules/providers/services/provider-commands.service.js';

async function writeCommand(root: string, relativePath: string, description: string): Promise<void> {
  const commandPath = path.join(root, relativePath);
  await mkdir(path.dirname(commandPath), { recursive: true });
  await writeFile(commandPath, `---\ndescription: ${description}\n---\nCommand body\n`, 'utf8');
}

test('provider commands include GJC text builtins, bundled prompts, and scoped files with precedence', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-commands-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const workspacePath = path.join(root, 'workspace');
  const userCommands = path.join(homeDir, '.gjc', 'agent', 'commands');
  const projectCommands = path.join(workspacePath, '.gjc', 'commands');

  await writeCommand(userCommands, 'review.md', 'User review');
  await writeCommand(projectCommands, 'review.md', 'Project review');
  await writeCommand(projectCommands, 'nested/check.md', 'Nested check');

  const service = createProviderCommandsService({
    homeDir,
    resolveProjectPath: (projectId) => projectId === 'project-1' ? workspacePath : null,
  });
  const commands = await service.listProviderCommands('project-1');

  assert.equal(commands.find((command) => command.name === '/review')?.description, 'Project review');
  assert.equal(commands.find((command) => command.name === '/nested/check')?.namespace, 'project');
  assert.equal(commands.some((command) => command.name === '/init' && command.namespace === 'bundled'), true);
  assert.equal(
    commands.filter((command) => command.namespace === 'builtin').length,
    GJC_APP_BUILTIN_COMMANDS.length,
  );
  assert.equal(commands.every((command) => command.type === 'provider'), true);
});
