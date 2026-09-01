import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

type SessionRow = { session_id: string; provider: string; provider_session_id: string | null; project_path: string | null; jsonl_path: string | null; custom_name: string | null; isStarred: number; isArchived: number; created_at: string; updated_at: string };
export type ProjectSessionPageRow = SessionRow & { total: number };

const rowColumns = 'session_id, provider, provider_session_id, project_path, jsonl_path, custom_name, isStarred, isArchived, created_at, updated_at';
const sqliteTimestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const recency = 'datetime(COALESCE(updated_at, created_at))';

function isoTimestamp(value?: string): string | null {
  if (!value) return null;
  const candidate = sqliteTimestamp.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function presentRow<T extends SessionRow | null | undefined>(value: T): T {
  if (value == null) return value;
  return {
    ...value,
    created_at: isoTimestamp(value.created_at) ?? value.created_at,
    updated_at: isoTimestamp(value.updated_at) ?? value.updated_at,
  };
}

function presentRows(rows: SessionRow[]): SessionRow[] {
  return rows.map((row) => presentRow(row) as SessionRow);
}

function providerProjectPath(_provider: string, projectPath: string): string {
  return normalizeProjectPath(projectPath);
}

function selectOne(sql: string, ...bindings: unknown[]): SessionRow | null {
  const value = getConnection().prepare(sql).get(...bindings) as SessionRow | undefined;
  return presentRow(value) ?? null;
}

function selectMany(sql: string, ...bindings: unknown[]): SessionRow[] {
  return presentRows(getConnection().prepare(sql).all(...bindings) as SessionRow[]);
}

function projectSessions(projectPath: string, archived: boolean, page?: { limit: number; offset: number }): SessionRow[] {
  const where = archived ? 'project_path = ?' : 'project_path = ? AND isArchived = 0';
  const paging = page ? ` ORDER BY ${recency} DESC, session_id DESC LIMIT ? OFFSET ?` : '';
  const bindings: unknown[] = [normalizeProjectPath(projectPath)];
  if (page) bindings.push(page.limit, page.offset);
  return selectMany(`SELECT ${rowColumns} FROM sessions WHERE ${where}${paging}`, ...bindings);
}

export const sessionsDb = {
  createSession(providerSessionId: string, provider: string, projectPath: string, customName?: string, createdAt?: string, updatedAt?: string, jsonlPath?: string | null): string {
    const db = getConnection();
    const storedProjectPath = providerProjectPath(provider, projectPath);
    const created = isoTimestamp(createdAt);
    const updated = isoTimestamp(updatedAt);
    projectsDb.ensureProjectPathForSession(storedProjectPath);

    const mapped = db.prepare('SELECT session_id FROM sessions WHERE provider = ? AND provider_session_id = ? LIMIT 1')
      .get(provider, providerSessionId) as { session_id: string } | undefined;
    if (mapped) {
      db.prepare(`UPDATE sessions SET provider = ?, project_path = ?, jsonl_path = ?, custom_name = COALESCE(?, custom_name), updated_at = COALESCE(?, CURRENT_TIMESTAMP) WHERE session_id = ?`)
        .run(provider, storedProjectPath, jsonlPath ?? null, customName ?? null, updated, mapped.session_id);
      return mapped.session_id;
    }

    db.prepare(`INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(session_id) DO UPDATE SET provider = excluded.provider, provider_session_id = excluded.provider_session_id, project_path = excluded.project_path, jsonl_path = excluded.jsonl_path, custom_name = COALESCE(excluded.custom_name, sessions.custom_name), updated_at = excluded.updated_at`)
      .run(providerSessionId, provider, providerSessionId, customName ?? null, storedProjectPath, jsonlPath ?? null, created, updated);
    return providerSessionId;
  },

  createAppSession(sessionId: string, provider: string, projectPath: string): string {
    const storedProjectPath = providerProjectPath(provider, projectPath);
    projectsDb.ensureProjectPathForSession(storedProjectPath);
    getConnection().prepare(`INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
      VALUES (?, ?, NULL, NULL, ?, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(sessionId, provider, storedProjectPath);
    return sessionId;
  },

  assignProviderSessionId(sessionId: string, provider: string, providerSessionId: string): void {
    const db = getConnection();
    db.transaction(() => {
      const target = db.prepare('SELECT session_id FROM sessions WHERE session_id = ? AND provider = ? LIMIT 1')
        .get(sessionId, provider) as { session_id: string } | undefined;
      if (!target) {
        throw new Error(`Cannot assign provider session id: target session "${sessionId}" for provider "${provider}" was not found`);
      }
      const other = db.prepare(`SELECT ${rowColumns} FROM sessions WHERE provider = ? AND (session_id = ? OR provider_session_id = ?) AND session_id <> ? LIMIT 1`)
        .get(provider, providerSessionId, providerSessionId, sessionId) as SessionRow | undefined;
      const result = db.prepare(`UPDATE sessions SET provider_session_id = ?, jsonl_path = COALESCE(jsonl_path, ?), custom_name = COALESCE(custom_name, ?), updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND provider = ?`)
        .run(providerSessionId, other?.jsonl_path ?? null, other?.custom_name ?? null, sessionId, provider);
      if (result.changes !== 1) {
        throw new Error(`Cannot assign provider session id: target session "${sessionId}" for provider "${provider}" was not updated`);
      }
      if (other) db.prepare('DELETE FROM sessions WHERE session_id = ? AND provider = ?').run(other.session_id, provider);
    })();
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    getConnection().prepare('UPDATE sessions SET custom_name = ? WHERE session_id = ?').run(customName, sessionId);
  },

  getSessionById(sessionId: string): SessionRow | null {
    return selectOne(`SELECT ${rowColumns} FROM sessions WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1`, sessionId);
  },

  getSessionByProviderSessionId(provider: string, providerSessionId: string): SessionRow | null {
    return selectOne(`SELECT ${rowColumns} FROM sessions WHERE provider = ? AND provider_session_id = ? ORDER BY updated_at DESC LIMIT 1`, provider, providerSessionId);
  },

  findLatestPendingAppSession(provider: string, projectPath: string): SessionRow | null {
    return selectOne(`SELECT ${rowColumns} FROM sessions WHERE provider = ? AND project_path = ? AND provider_session_id IS NULL AND isArchived = 0 ORDER BY ${recency} DESC, session_id DESC LIMIT 1`, provider, providerProjectPath(provider, projectPath));
  },

  getAllSessions(): SessionRow[] {
    return selectMany(`SELECT ${rowColumns} FROM sessions WHERE isArchived = 0`);
  },

  getArchivedSessions(): SessionRow[] {
    return selectMany(`SELECT ${rowColumns} FROM sessions WHERE isArchived = 1 ORDER BY ${recency} DESC, session_id DESC`);
  },

  getActiveSessionsUpdatedBefore(cutoffIso: string): SessionRow[] {
    return selectMany(`SELECT ${rowColumns} FROM sessions WHERE isArchived = 0 AND ${recency} < datetime(?) ORDER BY ${recency} ASC, session_id ASC`, cutoffIso);
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    return projectSessions(projectPath, false);
  },

  getSessionsByProjectPathIncludingArchived(projectPath: string): SessionRow[] {
    return projectSessions(projectPath, true);
  },

  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    return projectSessions(projectPath, false, { limit, offset });
  },

  getInitialSessionPagesByProject(limit: number): ProjectSessionPageRow[] {
    const rows = getConnection().prepare(`WITH numbered AS (
      SELECT ${rowColumns}, COUNT(*) OVER (PARTITION BY project_path) AS total,
        ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY ${recency} DESC, session_id DESC) AS position
      FROM sessions WHERE isArchived = 0
    ) SELECT ${rowColumns}, total FROM numbered WHERE position <= ? ORDER BY project_path, position`).all(limit) as ProjectSessionPageRow[];
    return rows.map((row) => ({ ...presentRow(row), total: Number(row.total) })) as ProjectSessionPageRow[];
  },

  countSessionsByProjectPath(projectPath: string): number {
    const row = getConnection().prepare('SELECT COUNT(*) AS count FROM sessions WHERE project_path = ? AND isArchived = 0').get(normalizeProjectPath(projectPath)) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  },

  getSessionsByProjectPathIncludingArchivedPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    return projectSessions(projectPath, true, { limit, offset });
  },

  countSessionsByProjectPathIncludingArchived(projectPath: string): number {
    const row = getConnection().prepare('SELECT COUNT(*) AS count FROM sessions WHERE project_path = ?').get(normalizeProjectPath(projectPath)) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    getConnection().prepare('DELETE FROM sessions WHERE project_path = ?').run(normalizeProjectPath(projectPath));
  },

  getSessionName(sessionId: string, provider: string): string | null {
    const row = getConnection().prepare('SELECT custom_name FROM sessions WHERE session_id = ? AND provider = ?').get(sessionId, provider) as { custom_name: string | null } | undefined;
    return row?.custom_name ?? null;
  },

  updateSessionIsArchived(sessionId: string, isArchived: boolean): void {
    getConnection().prepare('UPDATE sessions SET isArchived = ? WHERE session_id = ?').run(isArchived ? 1 : 0, sessionId);
  },

  updateSessionIsStarred(sessionId: string, isStarred: boolean): void {
    getConnection().prepare('UPDATE sessions SET isStarred = ? WHERE session_id = ?').run(isStarred ? 1 : 0, sessionId);
  },

  deleteSessionById(sessionId: string): boolean {
    return getConnection().prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
  },
};
