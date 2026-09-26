import { DEFAULT_GJC_PERMISSION_MODE, isGjcPermissionMode } from '@/gjc-engine.js';
import { getConnection } from '@/modules/database/connection.js';
import type { ProjectPermissionMode, ProjectPermissionsRow } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

type StoredRow = {
  project_path: string;
  mode: string;
  allow_always_json: string;
  updated_at: string | null;
};

const COLUMNS = 'project_path, mode, allow_always_json, updated_at';

function parseAllowList(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))].sort();
  } catch {
    return [];
  }
}

function toRow(stored: StoredRow): ProjectPermissionsRow {
  return {
    project_path: stored.project_path,
    mode: isGjcPermissionMode(stored.mode) ? stored.mode : DEFAULT_GJC_PERMISSION_MODE,
    allow_always: parseAllowList(stored.allow_always_json),
    updated_at: stored.updated_at,
  };
}

/** The policy every project starts with; never persisted as a row. */
export function defaultProjectPermissions(projectPath: string): ProjectPermissionsRow {
  return {
    project_path: normalizeProjectPath(projectPath),
    mode: DEFAULT_GJC_PERMISSION_MODE,
    allow_always: [],
    updated_at: null,
  };
}

function read(projectPath: string): ProjectPermissionsRow {
  const stored = getConnection()
    .prepare(`SELECT ${COLUMNS} FROM project_permissions WHERE project_path = ?`)
    .get(normalizeProjectPath(projectPath)) as StoredRow | undefined;
  return stored ? toRow(stored) : defaultProjectPermissions(projectPath);
}

function isDefault(row: ProjectPermissionsRow): boolean {
  return row.mode === DEFAULT_GJC_PERMISSION_MODE && row.allow_always.length === 0;
}

/**
 * Writes the whole policy. A row that equals the default is deleted instead,
 * so "reset" and "never configured" are the same state on disk and the
 * Settings listing only shows projects that actually deviate.
 */
function write(projectPath: string, next: Omit<ProjectPermissionsRow, 'project_path' | 'updated_at'>): ProjectPermissionsRow {
  const path = normalizeProjectPath(projectPath);
  const row: ProjectPermissionsRow = { project_path: path, updated_at: null, ...next, allow_always: [...new Set(next.allow_always)].sort() };
  if (isDefault(row)) {
    getConnection().prepare('DELETE FROM project_permissions WHERE project_path = ?').run(path);
    return defaultProjectPermissions(path);
  }
  getConnection().prepare(`
    INSERT INTO project_permissions (project_path, mode, allow_always_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project_path) DO UPDATE SET
      mode = excluded.mode,
      allow_always_json = excluded.allow_always_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(path, row.mode, JSON.stringify(row.allow_always));
  return read(path);
}

function setMode(projectPath: string, mode: ProjectPermissionMode): ProjectPermissionsRow {
  const current = read(projectPath);
  return write(projectPath, { mode, allow_always: current.allow_always });
}

function addAllowAlways(projectPath: string, toolName: string): ProjectPermissionsRow {
  const current = read(projectPath);
  if (current.allow_always.includes(toolName)) return current;
  return write(projectPath, { ...current, allow_always: [...current.allow_always, toolName] });
}

function removeAllowAlways(projectPath: string, toolName: string): ProjectPermissionsRow {
  const current = read(projectPath);
  if (!current.allow_always.includes(toolName)) return current;
  return write(projectPath, { ...current, allow_always: current.allow_always.filter((name) => name !== toolName) });
}

function reset(projectPath: string): ProjectPermissionsRow {
  getConnection().prepare('DELETE FROM project_permissions WHERE project_path = ?').run(normalizeProjectPath(projectPath));
  return defaultProjectPermissions(projectPath);
}

/** Rows that differ from the default; a stored row can equal it once the default moves. */
function listConfigured(): ProjectPermissionsRow[] {
  const rows = getConnection()
    .prepare(`SELECT ${COLUMNS} FROM project_permissions ORDER BY project_path`)
    .all() as StoredRow[];
  return rows.map(toRow).filter((row) => !isDefault(row));
}

export const projectPermissionsDb = {
  get: read,
  setMode,
  addAllowAlways,
  removeAllowAlways,
  reset,
  listConfigured,
};
