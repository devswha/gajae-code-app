import { api } from '../../../utils/api';
import type {
  BrowseFilesystemResponse,
  CloneProgressEvent,
  CreateFolderResponse,
  CreateProjectPayload,
  CreateProjectResponse,
  CredentialsResponse,
  FolderSuggestion,
  TokenMode,
} from '../types';

type CloneWorkspaceParams = {
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
};
type CloneProgressHandlers = { onProgress: (message: string) => void };

const readResponse = <T>(response: Response) => response.json() as Promise<T>;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const projectErrorMessage = (payload: CreateProjectResponse): string | null => {
  const directMessage = nonEmptyString(payload.details) ?? nonEmptyString(payload.error);
  if (directMessage) {
    return directMessage;
  }

  if (payload.error && typeof payload.error === 'object') {
    const apiError = payload.error as { message?: unknown; details?: unknown };
    const nestedMessage = nonEmptyString(apiError.details) ?? nonEmptyString(apiError.message);
    if (nestedMessage) {
      return nestedMessage;
    }

    if (apiError.details && typeof apiError.details === 'object') {
      const { projectPath } = apiError.details as { projectPath?: unknown };
      if (typeof projectPath === 'string') {
        return `Project path already exists: ${projectPath}`;
      }
    }
  }

  return nonEmptyString(payload.message);
};

export const fetchGithubTokenCredentials = async () => {
  const response = await api.get('/settings/credentials?type=github_token');
  const payload = await readResponse<CredentialsResponse>(response);
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load GitHub tokens');
  }

  return (payload.credentials || []).filter(({ is_active }) => is_active);
};

export const browseFilesystemFolders = async (pathToBrowse: string) => {
  const response = await api.get(`/browse-filesystem?path=${encodeURIComponent(pathToBrowse)}`);
  const payload = await readResponse<BrowseFilesystemResponse>(response);
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to browse filesystem');
  }

  return {
    path: payload.path || pathToBrowse,
    suggestions: (payload.suggestions || []) as FolderSuggestion[],
  };
};

export const createFolderInFilesystem = async (folderPath: string) => {
  const response = await api.createFolder(folderPath);
  const payload = await readResponse<CreateFolderResponse>(response);
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to create folder');
  }

  return payload.path || folderPath;
};

const existingProjectFrom = (response: CreateProjectResponse) => {
  if (!response.error || typeof response.error !== 'object') {
    return null;
  }

  const { details } = response.error as { details?: unknown };
  if (!details || typeof details !== 'object') {
    return null;
  }

  const { project } = details as { project?: unknown };
  return project && typeof project === 'object' ? project as Record<string, unknown> : null;
};

export const createProjectRequest = async (payload: CreateProjectPayload) => {
  const response = await api.createProject(payload);
  const result = await readResponse<CreateProjectResponse>(response);
  if (response.ok) {
    return result.project;
  }

  const errorCode = result.error && typeof result.error === 'object'
    ? (result.error as { code?: unknown }).code
    : undefined;
  const existingProject = existingProjectFrom(result);
  const projectId = typeof existingProject?.projectId === 'string'
    ? existingProject.projectId.trim()
    : '';

  if (errorCode === 'PROJECT_ALREADY_EXISTS' && existingProject && projectId) {
    if (existingProject.origin === 'explicit') {
      return existingProject;
    }

    const promotion = await api.promoteProject(projectId);
    const promoted = await readResponse<CreateProjectResponse>(promotion);
    if (!promotion.ok) {
      throw new Error(projectErrorMessage(promoted) || 'Failed to open existing project');
    }

    return promoted.project ?? { ...existingProject, origin: 'explicit' };
  }

  throw new Error(projectErrorMessage(result) || 'Failed to create project');
};

const cloneQuery = (params: CloneWorkspaceParams) => {
  const values = new URLSearchParams({
    path: params.workspacePath.trim(),
    githubUrl: params.githubUrl.trim(),
  });

  if (params.tokenMode === 'stored' && params.selectedGithubToken) {
    values.set('githubTokenId', params.selectedGithubToken);
  } else if (params.tokenMode === 'new' && params.newGithubToken.trim()) {
    values.set('newGithubToken', params.newGithubToken.trim());
  }

  return values.toString();
};

export const cloneWorkspaceWithProgress = (
  params: CloneWorkspaceParams,
  handlers: CloneProgressHandlers,
) => new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
  const source = new EventSource(`/api/projects/clone-progress?${cloneQuery(params)}`);
  let closed = false;
  const finish = (action: () => void) => {
    if (closed) {
      return;
    }
    closed = true;
    source.close();
    action();
  };

  source.onmessage = (event) => {
    try {
      const update = JSON.parse(event.data) as CloneProgressEvent;
      switch (update.type) {
        case 'progress':
          if (update.message) {
            handlers.onProgress(update.message);
          }
          break;
        case 'complete':
          finish(() => resolve(update.project));
          break;
        case 'error':
          finish(() => reject(new Error(update.message || 'Failed to clone repository')));
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Error parsing clone progress event:', error);
    }
  };

  source.onerror = () => {
    finish(() => reject(new Error('Connection lost during clone')));
  };
});
