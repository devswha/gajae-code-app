import { access, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import { createProject, promoteProjectOrigin, type ProjectApiView } from '@/modules/projects/services/project-management.service.js';
import { AppError, WORKSPACES_ROOT } from '@/shared/utils.js';

/*
 * The scratch workspace: one click from an empty workspace to a conversation.
 *
 * A first run should not begin with a folder picker. `<workspace root>/gajae-scratch`
 * is registered as a project (which validates the path and creates the folder,
 * exactly as "Add a project" does), made a git repository so the Changes tab and
 * the runtime's worktree-based jobs work from the first turn, given a README
 * when it is empty, and handed back so the client can open a conversation in
 * it. The project stays the sandbox boundary: the agent works inside that
 * folder, and nothing else.
 *
 * Starting it twice returns the same project. An archived one is reactivated,
 * an auto-discovered one is promoted - the same rules as "Add a project".
 * Registration runs first so a rejected path leaves nothing on disk.
 */

export const SCRATCH_WORKSPACE_DIRECTORY = 'gajae-scratch';
export const SCRATCH_WORKSPACE_NAME = 'Scratch';

const README = `# Scratch workspace

A disposable folder for trying Gajae Code. The agent works inside this
directory and nowhere else; delete it whenever you like and start over with
"Start in a scratch workspace".
`;

export type ScratchWorkspaceDependencies = {
  scratchPath: string;
  registerProject: (directoryPath: string, name: string) => Promise<ProjectApiView>; // validates, creates the folder, writes the row
  initializeRepository: (directoryPath: string) => Promise<boolean>; // false when git is unavailable
  writeReadme: (directoryPath: string) => Promise<boolean>; // true when the folder was empty and got one
};
// The seam exists for tests: production always passes `scratchWorkspaceSteps`.

export type ScratchWorkspaceResult = { project: ProjectApiView; outcome: 'created' | 'existing'; git: boolean };

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; stderr: string; error?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error: NodeJS.ErrnoException) => resolve({ code: null, stderr, error }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function initializeGitRepository(directoryPath: string): Promise<boolean> {
  const hasRepository = await access(path.join(directoryPath, '.git')).then(() => true, () => false);
  if (hasRepository) return true;
  const result = await run('git', ['init', '--quiet'], directoryPath);
  if (result.error?.code === 'ENOENT') return false; // no git on this machine: the folder still works as a project
  if (result.error) throw result.error;
  if (result.code !== 0) {
    throw new AppError(`git init failed: ${result.stderr.trim() || `exit ${result.code}`}`, { code: 'SCRATCH_GIT_INIT_FAILED', statusCode: 500 });
  }
  return true;
}

async function writeReadmeIfEmpty(directoryPath: string): Promise<boolean> {
  const entries = (await readdir(directoryPath)).filter((entry) => entry !== '.git');
  if (entries.length > 0) return false;
  await writeFile(path.join(directoryPath, 'README.md'), README, { flag: 'wx' });
  return true;
}

async function registerScratchProject(directoryPath: string, name: string): Promise<ProjectApiView> {
  try {
    return (await createProject({ projectPath: directoryPath, customName: name })).project;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'PROJECT_ALREADY_EXISTS') throw error;
    const existing = (error.details as { project?: ProjectApiView } | undefined)?.project;
    if (!existing) throw error;
    return existing.origin === 'explicit' ? existing : promoteProjectOrigin(existing.projectId);
  }
}

export const scratchWorkspaceSteps: ScratchWorkspaceDependencies = {
  scratchPath: path.join(WORKSPACES_ROOT, SCRATCH_WORKSPACE_DIRECTORY),
  registerProject: registerScratchProject,
  initializeRepository: initializeGitRepository,
  writeReadme: writeReadmeIfEmpty,
};

export async function startScratchWorkspace(dependencies: ScratchWorkspaceDependencies = scratchWorkspaceSteps): Promise<ScratchWorkspaceResult> {
  const project = await dependencies.registerProject(dependencies.scratchPath, SCRATCH_WORKSPACE_NAME);
  const directory = project.fullPath || dependencies.scratchPath; // the registered (realpath'd) folder
  const git = await dependencies.initializeRepository(directory);
  const created = await dependencies.writeReadme(directory);
  return { project, outcome: created ? 'created' : 'existing', git };
}
