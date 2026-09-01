import { api } from '../../../utils/api';

import { useApiSource } from './useApiSource';

export type FileResult = { path: string; name: string };
type FileNode = { type: 'file' | 'directory'; name: string; path: string; children?: FileNode[] };

const FILE_CAP = 500;

function collectFiles(roots: FileNode[]): FileResult[] {
  const found: FileResult[] = [];
  const pending = [...roots].reverse();

  while (pending.length > 0 && found.length < FILE_CAP) {
    const node = pending.pop();
    if (!node) continue;
    if (node.type === 'file') {
      found.push({ path: node.path, name: node.name });
      continue;
    }
    if (node.children) pending.push(...[...node.children].reverse());
  }

  return found;
}

export function useFilesSource(projectId: string | undefined, enabled: boolean) {
  const canLoad = Boolean(projectId) && enabled;
  return useApiSource<FileResult>({
    enabled: canLoad,
    deps: [projectId],
    fetcher: (signal) => api.getFiles(projectId!, { signal }),
    parse: (payload) => collectFiles(Array.isArray(payload) ? payload as FileNode[] : []),
  });
}
