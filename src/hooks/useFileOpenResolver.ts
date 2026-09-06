import { useCallback, useRef } from 'react';

import type { Project } from '../types/app';
import { api } from '../utils/api';

type FileNode = { type: 'file' | 'directory'; name: string; path: string; children?: FileNode[] };
type FileEntry = { name: string; path: string };
type OnFileOpen = (filePath: string, diffInfo?: any) => void;

const slashPath = (path: string) => path.replace(/\\/g, '/');
const isAbsolute = (path: string) => path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path);

function collectFiles(tree: FileNode[]): FileEntry[] {
  const files: FileEntry[] = [];
  const pending = [...tree].reverse();

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;

    if (node.type === 'file') {
      files.push({ name: node.name, path: node.path });
      continue;
    }

    if (node.children) pending.push(...[...node.children].reverse());
  }

  return files;
}

function resolveReference(files: FileEntry[], reference: string): string | undefined {
  if (isAbsolute(reference)) return files.find((file) => slashPath(file.path) === slashPath(reference))?.path;
  const relativePath = slashPath(reference).trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (relativePath.length === 0) return undefined;

  for (const file of files) {
    const candidate = slashPath(file.path);
    if (candidate === relativePath || candidate.endsWith(`/${relativePath}`)) return file.path;
  }

  if (relativePath.includes('/')) return undefined;
  const matches = files.filter((file) => file.name === relativePath);
  return matches.length === 1 ? matches[0].path : undefined;
}

async function fetchProjectFiles(projectId: string, sessionId?: string): Promise<FileEntry[] | null> {
  try {
    const response = await api.getFiles(projectId, {}, sessionId);
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return collectFiles(Array.isArray(payload) ? payload as FileNode[] : []);
  } catch {
    // Resolution remains best-effort when the project tree cannot be read.
    return null;
  }
}

export function useFileOpenResolver(
  selectedProject: Project | null | undefined,
  onFileOpen: OnFileOpen,
  sessionId?: string,
  executionCwd?: string | null,
): OnFileOpen {
  const selectedId = selectedProject?.projectId;
  const cachedRequest = useRef<{ id: string | undefined; result: Promise<FileEntry[]> | undefined }>({
    id: undefined,
    result: undefined,
  });

  const filesForSelectedProject = useCallback(() => {
    if (!selectedId) return Promise.resolve([]);

    const cache = cachedRequest.current;
    const identity = `${selectedId}:${sessionId ?? ''}:${executionCwd ?? ''}`;
    if (cache.id === identity && cache.result) return cache.result;

    const result = fetchProjectFiles(selectedId, sessionId).then((files) => {
      // A pending worktree or transient failure must remain retryable.
      if (files === null && cachedRequest.current.result === result) cachedRequest.current.result = undefined;
      return files ?? [];
    });
    cachedRequest.current = { id: identity, result };
    return result;
  }, [selectedId, sessionId, executionCwd]);

  return useCallback((filePath: string, diffInfo?: any) => {
    void filesForSelectedProject().then((files) => {
      const resolved = resolveReference(files, filePath);
      // A relative reference in a session must not fall through to the server
      // process cwd when its selected workspace is pending or unavailable.
      const absolute = isAbsolute(filePath);
      if (resolved || !sessionId || absolute) onFileOpen(resolved ?? filePath, diffInfo);
    });
  }, [filesForSelectedProject, onFileOpen, sessionId]);
}
