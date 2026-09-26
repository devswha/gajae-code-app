import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authenticatedFetch } from '../utils/api';

export const PERMISSION_MODES = ['ask', 'auto_edits', 'bypass'] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];
/** Matches the GJC CLI, which runs its tools without asking. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'bypass';

export type ProjectPermissions = {
  projectId: string;
  projectPath: string;
  mode: PermissionMode;
  allowAlways: string[];
  updatedAt: string | null;
};

export const isPermissionMode = (value: unknown): value is PermissionMode =>
  typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);

export const projectPermissionsQueryKey = (projectId: string) => ['project-permissions', projectId] as const;
export const CONFIGURED_PERMISSIONS_QUERY_KEY = ['project-permissions', 'configured'] as const;

/** What the composer shows before the server has answered: the default policy. */
export const defaultProjectPermissions = (projectId: string): ProjectPermissions => ({
  projectId,
  projectPath: '',
  mode: DEFAULT_PERMISSION_MODE,
  allowAlways: [],
  updatedAt: null,
});

const readPermissions = (payload: unknown): ProjectPermissions | null => {
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.projectId !== 'string' || !isPermissionMode(record.mode)) return null;
  return {
    projectId: record.projectId,
    projectPath: typeof record.projectPath === 'string' ? record.projectPath : '',
    mode: record.mode,
    allowAlways: Array.isArray(record.allowAlways) ? record.allowAlways.filter((tool): tool is string => typeof tool === 'string') : [],
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
  };
};

async function requestPermissions(url: string, init: RequestInit = {}): Promise<ProjectPermissions> {
  const response = await authenticatedFetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' ? (body as { error?: unknown; code?: unknown }) : {};
    const failure = new Error(typeof error.error === 'string' ? error.error : `Permission request failed (${response.status})`);
    (failure as Error & { code?: string }).code = typeof error.code === 'string' ? error.code : undefined;
    throw failure;
  }
  const permissions = readPermissions(body);
  if (!permissions) throw new Error('Permission response was not understood');
  return permissions;
}

const permissionsUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/permissions`;

export type PermissionModeUpdate = { mode: PermissionMode };

/**
 * The selected project's permission policy, and the mutations that change it.
 *
 * Every change goes to the server first and the cache second: the worker reads
 * the stored policy when the next run starts, so a value that only lived in the
 * browser would be a lie about what the agent may do.
 */
export function useProjectPermissions(projectId: string | null | undefined) {
  const client = useQueryClient();
  const enabled = Boolean(projectId);
  const query = useQuery({
    queryKey: projectPermissionsQueryKey(projectId ?? ''),
    queryFn: () => requestPermissions(permissionsUrl(projectId!)),
    enabled,
    staleTime: 30_000,
  });

  const store = (permissions: ProjectPermissions) => {
    client.setQueryData(projectPermissionsQueryKey(permissions.projectId), permissions);
    void client.invalidateQueries({ queryKey: CONFIGURED_PERMISSIONS_QUERY_KEY });
  };

  const setMode = useMutation({
    mutationFn: (update: PermissionModeUpdate) => requestPermissions(permissionsUrl(projectId!), {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
    onSuccess: store,
  });
  const revoke = useMutation({
    mutationFn: (toolName: string) => requestPermissions(`${permissionsUrl(projectId!)}/allow/${encodeURIComponent(toolName)}`, { method: 'DELETE' }),
    onSuccess: store,
  });
  const reset = useMutation({
    mutationFn: () => requestPermissions(permissionsUrl(projectId!), { method: 'DELETE' }),
    onSuccess: store,
  });

  // Only a successful server read establishes the policy. A failed read must
  // never manufacture a mode the project is not in.
  // Query retains the last confirmed policy if a later refresh fails.
  const permissions = query.data ?? null;

  return {
    permissions,
    isLoading: enabled && query.isPending,
    setMode: setMode.mutateAsync,
    isSettingMode: setMode.isPending,
    revokeAlwaysAllow: revoke.mutateAsync,
    reset: reset.mutateAsync,
  };
}

/** Every project whose policy differs from the default, for Settings. */
export function useConfiguredProjectPermissions(enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: CONFIGURED_PERMISSIONS_QUERY_KEY,
    enabled,
    queryFn: async (): Promise<ProjectPermissions[]> => {
      const response = await authenticatedFetch('/api/projects/permissions');
      if (!response.ok) throw new Error(`Failed to load permissions (${response.status})`);
      const body = await response.json() as { data?: { projects?: unknown[] } };
      return (body.data?.projects ?? [])
        .map((entry) => readPermissions({ data: entry }))
        .filter((entry): entry is ProjectPermissions => entry !== null);
    },
  });

  const refresh = (permissions: ProjectPermissions) => {
    client.setQueryData(projectPermissionsQueryKey(permissions.projectId), permissions);
    void client.invalidateQueries({ queryKey: CONFIGURED_PERMISSIONS_QUERY_KEY });
  };
  const revoke = useMutation({
    mutationFn: ({ projectId, toolName }: { projectId: string; toolName: string }) =>
      requestPermissions(`${permissionsUrl(projectId)}/allow/${encodeURIComponent(toolName)}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: (projectId: string) => requestPermissions(permissionsUrl(projectId), { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return {
    projects: query.data ?? [],
    isLoading: query.isPending,
    error: query.error,
    revokeAlwaysAllow: revoke.mutateAsync,
    reset: reset.mutateAsync,
  };
}
