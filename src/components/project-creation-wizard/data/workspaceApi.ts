import { api } from '../../../utils/api';
import type {
  BrowseFilesystemResponse,
  CreateFolderResponse,
  CreateProjectPayload,
  CreateProjectResponse,
  FolderSuggestion,
} from '../types';

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
