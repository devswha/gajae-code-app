const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;

/** Anything that survives `JSON.stringify`. Request bodies are not inspected here. */
type JsonBody = unknown;

const withBootstrapTimeout = (
  request: (signal: AbortSignal) => Promise<Response>,
  externalSignal?: AbortSignal | null,
): Promise<Response> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, AUTH_BOOTSTRAP_TIMEOUT_MS);
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) abort();

  return request(controller.signal).finally(() => {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abort);
  });
};

// Utility function for same-origin API calls.
export const authenticatedFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const defaultHeaders: Record<string, string> = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...defaultHeaders,
      // Callers pass plain objects; a `Headers` instance would not spread, and
      // none is ever passed. Preserved as-is from the JavaScript this replaced.
      ...(options.headers as Record<string, string> | undefined),
    },
  });
};

// API endpoints
export const api = {
  auth: {
    user: (options: RequestInit = {}) => withBootstrapTimeout(
      (signal) => authenticatedFetch('/api/auth/user', { ...options, signal }),
      options.signal,
    ),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => authenticatedFetch('/api/projects?skipSynchronization=1'),
  gjcJobs: {
    list: () => authenticatedFetch('/api/gjc/jobs'),
    get: (jobId: string) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}`),
    create: (input: JsonBody) => authenticatedFetch('/api/gjc/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    abort: (jobId: string) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/abort`, { method: 'POST' }),
    turn: (jobId: string, input: JsonBody) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/turns`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    resume: (jobId: string, input: JsonBody) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/resume`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    replay: (jobId: string, after: number = 0) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/replay?after=${encodeURIComponent(after)}`),
    diff: (jobId: string) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/git/diff`),
    commit: (jobId: string, input: JsonBody) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/git/commit`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    publish: (jobId: string) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/git/publish`, {
      method: 'POST',
    }),
    createPullRequest: (jobId: string, input: JsonBody) => authenticatedFetch(`/api/gjc/jobs/${encodeURIComponent(jobId)}/git/pr`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  },
  archivedProjects: () => authenticatedFetch('/api/projects/archived'),
  // Read-only working-tree summary for the Workspace status tab: branch plus
  // the files git reports as changed. Never writes to the repository.
  gitStatus: (projectId: string) =>
    authenticatedFetch(`/api/git/status?project=${encodeURIComponent(projectId)}`),
  // Home-relative directory autocomplete ({ home, suggestions }).
  dirSuggestions: (prefix: string) =>
    authenticatedFetch(`/api/providers/fs/dir-suggestions?prefix=${encodeURIComponent(prefix)}`),
  projectSessions: (projectId: string, { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/sessions?${params.toString()}`);
  },
  // Unified endpoint for persisted session messages.
  // Provider/project metadata are resolved by the backend from sessionId.
  unifiedSessionMessages: (
    sessionId: string,
    _provider: string = 'gjc',
    { limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', String(limit));
      params.append('offset', String(offset));
    }
    const queryString = params.toString();
    return authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages${queryString ? `?${queryString}` : ''}`);
  },
  renameProject: (projectId: string, displayName: string) =>
    authenticatedFetch(`/api/projects/${projectId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  restoreProject: (projectId: string) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/restore`, {
      method: 'POST',
    }),
  // Session deletion now mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete: boolean = false) => {
    const params = new URLSearchParams();
    if (hardDelete) {
      params.set('force', 'true');
    }
    const qs = params.toString();
    return authenticatedFetch(`/api/providers/sessions/${sessionId}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  getArchivedSessions: () =>
    authenticatedFetch('/api/providers/sessions/archived'),
  // Bulk-archives sessions idle past `olderThanDays`. Pass `dryRun` to get the
  // count without changing anything; both modes run the same selection.
  archiveIdleSessions: (olderThanDays: number, dryRun: boolean = false) =>
    authenticatedFetch('/api/providers/sessions/archive-idle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays, dryRun }),
    }),
  runningSessions: () =>
    authenticatedFetch('/api/providers/sessions/running'),
  restoreSession: (sessionId: string) =>
    authenticatedFetch(`/api/providers/sessions/${sessionId}/restore`, {
      method: 'POST',
    }),
  renameSession: (sessionId: string, summary: string) =>
    authenticatedFetch(`/api/providers/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ summary }),
    }),
  // Replaces the stored title with one derived afresh from the transcript.
  regenerateSessionTitle: (sessionId: string) =>
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/regenerate-title`, {
      method: 'POST',
    }),
  toggleSessionStar: (sessionId: string) =>
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/toggle-star`, {
      method: 'POST',
    }),
  // Returns the Markdown file itself rather than the usual JSON envelope, so the
  // caller reads the body as a blob. It goes through authenticatedFetch because
  // a plain link cannot carry the auth header.
  exportSession: (sessionId: string) =>
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/export`),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete: boolean = false) => {
    const params = new URLSearchParams();
    if (hardDelete) params.set('force', 'true');
    const qs = params.toString();
    return authenticatedFetch(`/api/projects/${projectId}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  searchConversationsUrl: (query: string, limit: number = 50, projectId?: string) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (projectId !== undefined) params.set('projectId', projectId);
    return `/api/providers/search/sessions?${params.toString()}`;
  },
  createProject: (projectData: JsonBody) =>
    authenticatedFetch('/api/projects/create-project', {
      method: 'POST',
      body: JSON.stringify(projectData),
    }),
  // Creates and registers `~/gajae-scratch` (idempotent); the empty workspace's one-click start.
  startScratchWorkspace: () =>
    authenticatedFetch('/api/projects/scratch', { method: 'POST' }),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    authenticatedFetch('/api/projects/migrate-legacy-stars', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    }),
  promoteProject: (projectId: string) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/promote`, {
      method: 'POST',
    }),
  toggleProjectStar: (projectId: string) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`, {
      method: 'POST',
    }),
  getFiles: (projectId: string, options: RequestInit = {}) =>
    authenticatedFetch(`/api/projects/${projectId}/files`, options),


  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath: string | null = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath: string) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName: string, gitEmail: string) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
  },

  // Host integration: hand a file to the user's own editor.
  system: {
    openFile: (path: string) =>
      authenticatedFetch('/api/system/open-file', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint: string) => authenticatedFetch(`/api${endpoint}`),

  // Generic POST method for any endpoint
  post: (endpoint: string, body?: JsonBody) => authenticatedFetch(`/api${endpoint}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body) }),
  }),

  // Generic PUT method for any endpoint
  put: (endpoint: string, body: JsonBody) => authenticatedFetch(`/api${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  // Generic DELETE method for any endpoint
  delete: (endpoint: string, options: RequestInit = {}) => authenticatedFetch(`/api${endpoint}`, {
    method: 'DELETE',
    ...options,
  }),
};
