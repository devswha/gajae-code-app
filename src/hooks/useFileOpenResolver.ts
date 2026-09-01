import { useCallback, useRef } from 'react';

import type { Project } from '../types/app';
import { api } from '../utils/api';

type FileNode = { type: 'file' | 'directory'; name: string; path: string; children?: FileNode[] };
type FileEntry = { name: string; path: string };
type OnFileOpen = (filePath: string, diffInfo?: any) => void;

const slashPath = (path: string) => path.replace(/\\/g, '/');

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
  const relativePath = slashPath(reference).trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (relativePath.length === 0) return undefined;

  for (const file of files) {
    const candidate = slashPath(file.path);
    if (candidate === relativePath || candidate.endsWith(`/${relativePath}`)) return file.path;
  }

  const filename = relativePath.split('/').at(-1);
  return files.find((file) => file.name === filename)?.path;
}

async function fetchProjectFiles(projectId: string): Promise<FileEntry[]> {
  try {
    const response = await api.getFiles(projectId);
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    return collectFiles(Array.isArray(payload) ? payload as FileNode[] : []);
  } catch {
    // Resolution remains best-effort when the project tree cannot be read.
    return [];
  }
}

export function useFileOpenResolver(
  selectedProject: Project | null | undefined,
  onFileOpen: OnFileOpen,
): OnFileOpen {
  const selectedId = selectedProject?.projectId;
  const cachedRequest = useRef<{ id: string | undefined; result: Promise<FileEntry[]> | undefined }>({
    id: undefined,
    result: undefined,
  });

  const filesForSelectedProject = useCallback(() => {
    if (!selectedId) return Promise.resolve([]);

    const cache = cachedRequest.current;
    if (cache.id === selectedId && cache.result) return cache.result;

    const result = fetchProjectFiles(selectedId);
    cachedRequest.current = { id: selectedId, result };
    return result;
  }, [selectedId]);

  return useCallback((filePath: string, diffInfo?: any) => {
    void filesForSelectedProject().then((files) => {
      onFileOpen(resolveReference(files, filePath) ?? filePath, diffInfo);
    });
  }, [filesForSelectedProject, onFileOpen]);
}
