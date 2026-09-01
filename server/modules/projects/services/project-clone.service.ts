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
  validatePath: (requestedPath: string) => Promise<WorkspacePathValidationResult>;
  ensureDirectory: (directoryPath: string) => Promise<void>;
  pathExists: (targetPath: string) => Promise<boolean>;
  removePath: (targetPath: string) => Promise<void>;
  getGithubTokenById: (tokenId: number, userId: number) => Promise<{ github_token: string } | null>;
  spawnGitClone: (cloneUrl: string, clonePath: string) => GitCloneProcess;
  registerProject: (projectPath: string, customName: string) => Promise<{ project: Record<string, unknown> }>;
  logError: (message: string, error: unknown) => void;
};
export type CloneProjectOperation = { waitForCompletion: Promise<void>; cancel: () => void };

async function doesNotExist(target: string): Promise<boolean> {
  try {
    await access(target);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

function required(value: string, code: 'WORKSPACE_PATH_REQUIRED' | 'GITHUB_URL_REQUIRED'): void {
  if (value) return;
  throw new AppError('workspacePath and githubUrl are required', { code, statusCode: 400 });
}

function cloneName(url: string): string {
  return url.replace(/\/+$/, '').replace(/\.git$/, '').split('/').pop() || 'repository';
}

function credentialsUrl(url: string, token: string | null): string {
  if (!token) return url;
  try {
    const target = new URL(url);
    target.username = token;
    target.password = '';
    return target.toString();
  } catch {
    return url;
  }
}

function displayFailure(stderr: string, secret: string | null): string {
  if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) return 'Authentication failed. Please check your credentials.';
  if (stderr.includes('Repository not found')) return 'Repository not found. Please check the URL and ensure you have access.';
  if (stderr.includes('already exists')) return 'Directory already exists';
  if (!stderr || !secret) return stderr || 'Git clone failed';
  return stderr.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
}

function errorText(error: unknown): string {
  return error instanceof AppError ? error.message : error instanceof Error && error.message ? error.message : 'Unexpected error';
}

async function selectedToken(input: CloneProjectInput, dependencies: CloneProjectDependencies): Promise<string | null> {
  if (typeof input.githubTokenId !== 'number') {
    return input.newGithubToken && input.newGithubToken.trim().length > 0 ? input.newGithubToken.trim() : null;
  }
  const userId = typeof input.userId === 'number' ? input.userId : Number.parseInt(String(input.userId), 10);
  if (Number.isNaN(userId)) throw new AppError('Authenticated user is required', { code: 'AUTHENTICATION_REQUIRED', statusCode: 401 });
  const record = await dependencies.getGithubTokenById(input.githubTokenId, userId);
  if (!record) throw new AppError('GitHub token not found', { code: 'GITHUB_TOKEN_NOT_FOUND', statusCode: 404 });
  return record.github_token;
}

const defaultDependencies: CloneProjectDependencies = {
  validatePath: validateWorkspacePath,
  ensureDirectory: async (directory) => { await mkdir(directory, { recursive: true }); },
  pathExists: async (target) => !(await doesNotExist(target)),
  removePath: (target) => rm(target, { recursive: true, force: true }),
  getGithubTokenById: async (tokenId, userId) => githubTokensDb.getGithubTokenById(userId, tokenId) as { github_token: string } | null,
  spawnGitClone: (url, destination) => spawn('git', ['clone', '--progress', '--', url, destination], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }) as unknown as GitCloneProcess,
  registerProject: (projectPath, customName) => createProject({ projectPath, customName }) as Promise<{ project: Record<string, unknown> }>,
  logError: (message, error) => console.error(message, error),
};

export async function startCloneProject(input: CloneProjectInput, handlers: CloneProjectEventHandlers, dependencies: CloneProjectDependencies = defaultDependencies): Promise<CloneProjectOperation> {
  const workspace = input.workspacePath.trim();
  const source = input.githubUrl.trim();
  required(workspace, 'WORKSPACE_PATH_REQUIRED');
  required(source, 'GITHUB_URL_REQUIRED');
  if (source.startsWith('-')) throw new AppError('Invalid githubUrl', { code: 'INVALID_GITHUB_URL', statusCode: 400 });

  const validation = await dependencies.validatePath(workspace);
  if (!validation.valid || !validation.resolvedPath) throw new AppError(validation.error || 'Invalid workspace path', { code: 'INVALID_PROJECT_PATH', statusCode: 400 });
  await dependencies.ensureDirectory(validation.resolvedPath);

  const token = await selectedToken(input, dependencies);
  const name = cloneName(source);
  const destination = path.join(validation.resolvedPath, name);
  if (await dependencies.pathExists(destination)) {
    throw new AppError(`Directory "${name}" already exists. Please choose a different location or remove the existing directory.`, { code: 'CLONE_TARGET_ALREADY_EXISTS', statusCode: 409 });
  }

  handlers.onProgress(`Cloning into '${name}'...`);
  const child = dependencies.spawnGitClone(credentialsUrl(source, token), destination);
  let stderr = '';
  const publish = (data: Buffer | string, remember = false): void => {
    const message = data.toString().trim();
    if (remember) stderr = message;
    if (message) handlers.onProgress(message);
  };
  child.stdout?.on('data', (data: Buffer | string) => publish(data));
  child.stderr?.on('data', (data: Buffer | string) => publish(data, true));

  const waitForCompletion = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => reject(new AppError(error.code === 'ENOENT' ? 'Git is not installed or not in PATH' : error.message, { code: error.code === 'ENOENT' ? 'GIT_NOT_FOUND' : 'GIT_EXECUTION_FAILED', statusCode: 500 })));
    child.on('close', async (exitCode) => {
      if (exitCode === 0) {
        try {
          const result = await dependencies.registerProject(destination, name);
          handlers.onComplete({ project: result.project, message: 'Repository cloned successfully' });
          resolve();
        } catch (error) {
          reject(new AppError(`Clone succeeded but failed to add project: ${errorText(error)}`, { code: 'CLONE_PROJECT_REGISTRATION_FAILED', statusCode: 500 }));
        }
        return;
      }
      try {
        await dependencies.removePath(destination);
      } catch (error) {
        dependencies.logError('Failed to clean up after clone failure:', error);
      }
      reject(new AppError(displayFailure(stderr, token), { code: 'GIT_CLONE_FAILED', statusCode: 500 }));
    });
  });
  return { waitForCompletion, cancel: () => child.kill() };
}
