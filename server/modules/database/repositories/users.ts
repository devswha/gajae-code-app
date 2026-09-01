import { getConnection } from '@/modules/database/connection.js';

type PublicUser = { created_at: string; id: number; last_login: string | null; username: string };

type GitIdentity = { git_email: string | null; git_name: string | null };

type NewUser = { id: number | bigint; username: string };

const insertUser = (username: string, passwordHash: string): NewUser => {
  const insertion = getConnection()
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);

  return { id: insertion.lastInsertRowid, username };
};

const findActiveUser = (userId: number): PublicUser | undefined => {
  const sql = [
    'SELECT id, username, created_at, last_login',
    'FROM users',
    'WHERE is_active = 1 AND id = ?',
  ].join(' ');

  return getConnection().prepare(sql).get(userId) as PublicUser | undefined;
};

const findFirstActiveUser = (): PublicUser | undefined => {
  const sql = `
    SELECT id, username, created_at, last_login
    FROM users
    WHERE is_active = 1
    LIMIT 1
  `;

  return getConnection().prepare(sql).get() as PublicUser | undefined;
};

const saveGitIdentity = (userId: number, gitName: string, gitEmail: string): void => {
  const sql = 'UPDATE users SET git_name = ?, git_email = ? WHERE id = ?';
  getConnection().prepare(sql).run(gitName, gitEmail, userId);
};

const loadGitIdentity = (userId: number): GitIdentity | undefined => {
  return getConnection()
    .prepare('SELECT git_name, git_email FROM users WHERE id = ?')
    .get(userId) as GitIdentity | undefined;
};

export const userDb = {
  createUser: insertUser,
  getUserById: findActiveUser,
  getFirstUser: findFirstActiveUser,
  updateGitConfig: saveGitIdentity,
  getGitConfig: loadGitIdentity,
};
