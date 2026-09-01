import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import { githubTokensDb } from '@/modules/database/index.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import type { WorkspacePathValidationResult } from '@/shared/types.js';
import { AppError, validateWorkspacePath } from '@/shared/utils.js';

type CloneProjectInput = { workspacePath: string; githubUrl: string; githubTokenId?: number | null; newGithubToken?: string | null; userId: number | string };
type CloneCompletePayload = { project: Record<string, unknown>; message: string };
type CloneProjectEventHandlers = { onProgress: (message: string) => void; onComplete: (payload: CloneCompletePayload) => void };
type GitCloneProcess = { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; on(event: 'close', listener: (code: number | null) => void): void; on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): void; kill(): void };
type CloneProjectDependencies = {
  validatePath: (requestedPath: string) => Promise<WorkspacePathValidationResult>; // workspace containment gate
  ensureDirectory: (directoryPath: string) => Promise<void>; // mkdir -p semantics
  pathExists: (targetPath: string) => Promise<boolean>; // probe without following the clone
  removePath: (targetPath: string) => Promise<void>; // rm -rf semantics, used for cleanup
  getGithubTokenById: (tokenId: number, userId: number) => Promise<{ github_token: string } | null>;
  spawnGitClone: (cloneUrl: string, clonePath: string) => GitCloneProcess; // git clone --progress
  registerProject: (projectPath: string, customName: string) => Promise<{ project: Record<string, unknown> }>; // hands off to project-management
  logError: (message: string, error: unknown) => void; // cleanup failures are logged, not thrown
};
// The seam exists for tests; production wiring is cloneDependencies below.
export type CloneProjectOperation = { waitForCompletion: Promise<void>; cancel: () => void };

async function pathIsAvailable(target: string): Promise<boolean> {
  // ENOENT is the answer we want; every other probe failure is a real error.
  const probe = await access(target).then(
    () => 'occupied' as const,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return 'available' as const;
      throw error;
    },
  );
  return probe === 'available';
}

function requireCloneInput(value: string, code: 'WORKSPACE_PATH_REQUIRED' | 'GITHUB_URL_REQUIRED'): void {
  if (value) return;
  throw new AppError('workspacePath and githubUrl are required', { code, statusCode: 400 });
}

function repositoryName(githubUrl: string): string {
  const segments = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  return segments.at(-1) || 'repository';
}

function authenticatedCloneUrl(githubUrl: string, token: string | null): string {
  if (!token) return githubUrl;
  try {
    const cloneUrl = new URL(githubUrl);
    cloneUrl.username = token;
    cloneUrl.password = '';
    return cloneUrl.toString();
  } catch {
    return githubUrl;
  }
}

function cloneFailureMessage(stderr: string, token: string | null): string {
  if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) return 'Authentication failed. Please check your credentials.';
  if (stderr.includes('Repository not found')) return 'Repository not found. Please check the URL and ensure you have access.';
  if (stderr.includes('already exists')) return 'Directory already exists';
  if (!stderr || !token) return stderr || 'Git clone failed';
  return stderr.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
}

function messageFor(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error && error.message ? error.message : 'Unexpected error';
}

async function githubToken(input: CloneProjectInput, dependencies: CloneProjectDependencies): Promise<string | null> {
  if (typeof input.githubTokenId !== 'number') {
    return input.newGithubToken && input.newGithubToken.trim().length > 0 ? input.newGithubToken.trim() : null;
  }

  const userId = typeof input.userId === 'number' ? input.userId : Number.parseInt(String(input.userId), 10);
  if (Number.isNaN(userId)) {
    throw new AppError('Authenticated user is required', { code: 'AUTHENTICATION_REQUIRED', statusCode: 401 });
  }
  const token = await dependencies.getGithubTokenById(input.githubTokenId, userId);
  if (!token) throw new AppError('GitHub token not found', { code: 'GITHUB_TOKEN_NOT_FOUND', statusCode: 404 });
  return token.github_token;
}

const cloneDependencies: CloneProjectDependencies = {
  ensureDirectory: async (directory) => { await mkdir(directory, { recursive: true }); },
  validatePath: validateWorkspacePath, // shared workspace gate from utils
  pathExists: async (target) => !(await pathIsAvailable(target)),
  removePath: (target) => rm(target, { recursive: true, force: true }),
  getGithubTokenById: async (tokenId, userId) => githubTokensDb.getGithubTokenById(userId, tokenId) as { github_token: string } | null,
  spawnGitClone: (url, destination) => spawn('git', ['clone', '--progress', '--', url, destination], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }) as unknown as GitCloneProcess,
  registerProject: (projectPath, customName) => createProject({ projectPath, customName }) as Promise<{ project: Record<string, unknown> }>,
  logError: (message, error) => console.error(message, error),
};

export async function startCloneProject(input: CloneProjectInput, handlers: CloneProjectEventHandlers, dependencies: CloneProjectDependencies = cloneDependencies): Promise<CloneProjectOperation> {
  const workspacePath = input.workspacePath.trim();
  const githubUrl = input.githubUrl.trim();
  requireCloneInput(workspacePath, 'WORKSPACE_PATH_REQUIRED');
  requireCloneInput(githubUrl, 'GITHUB_URL_REQUIRED');
  if (githubUrl.startsWith('-')) throw new AppError('Invalid githubUrl', { code: 'INVALID_GITHUB_URL', statusCode: 400 });

  const checkedWorkspace = await dependencies.validatePath(workspacePath);
  if (!checkedWorkspace.valid || !checkedWorkspace.resolvedPath) {
    throw new AppError(checkedWorkspace.error || 'Invalid workspace path', { code: 'INVALID_PROJECT_PATH', statusCode: 400 });
  }
  await dependencies.ensureDirectory(checkedWorkspace.resolvedPath);

  const token = await githubToken(input, dependencies);
  const name = repositoryName(githubUrl);
  const destination = path.join(checkedWorkspace.resolvedPath, name);
  if (await dependencies.pathExists(destination)) {
    throw new AppError(`Directory "${name}" already exists. Please choose a different location or remove the existing directory.`, { code: 'CLONE_TARGET_ALREADY_EXISTS', statusCode: 409 });
  }

  handlers.onProgress(`Cloning into '${name}'...`);
  const child = dependencies.spawnGitClone(authenticatedCloneUrl(githubUrl, token), destination);
  let stderr = '';
  const reportOutput = (chunk: Buffer | string, isErrorOutput: boolean): void => {
    const message = chunk.toString().trim();
    if (isErrorOutput) stderr = message;
    if (message) handlers.onProgress(message);
  };
  child.stdout?.on('data', (chunk: Buffer | string) => reportOutput(chunk, false));
  child.stderr?.on('data', (chunk: Buffer | string) => reportOutput(chunk, true));

  const completion = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      const missingGit = error.code === 'ENOENT';
      const failure = { code: missingGit ? 'GIT_NOT_FOUND' : 'GIT_EXECUTION_FAILED', statusCode: 500 };
      reject(new AppError(missingGit ? 'Git is not installed or not in PATH' : error.message, failure));
    });
    child.on('close', async (exitCode) => {
      if (exitCode !== 0) {
        await dependencies.removePath(destination).catch((error: unknown) => {
          dependencies.logError('Failed to clean up after clone failure:', error);
        });
        return reject(new AppError(cloneFailureMessage(stderr, token), { code: 'GIT_CLONE_FAILED', statusCode: 500 }));
      }

      try {
        const result = await dependencies.registerProject(destination, name);
        handlers.onComplete({ project: result.project, message: 'Repository cloned successfully' });
        resolve();
      } catch (error) {
        reject(new AppError(`Clone succeeded but failed to add project: ${messageFor(error)}`, { code: 'CLONE_PROJECT_REGISTRATION_FAILED', statusCode: 500 }));
      }
    });
  });

  return { waitForCompletion: completion, cancel: () => child.kill() };
}
