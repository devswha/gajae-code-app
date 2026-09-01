import { getConnection } from '@/modules/database/connection.js';
import type { CreateCredentialResult, CredentialPublicRow } from '@/shared/types.js';

const PUBLIC_CREDENTIAL_COLUMNS =
  'id, credential_name, credential_type, description, created_at, is_active';

const didAffectRow = (changes: number): boolean => changes > 0;

const listForUser = (
  userId: number,
  credentialType: string | null
): CredentialPublicRow[] => {
  const typeClause = credentialType ? ' AND credential_type = ?' : '';
  const parameters = credentialType ? [userId, credentialType] : [userId];
  const statement = `
    SELECT ${PUBLIC_CREDENTIAL_COLUMNS}
    FROM user_credentials
    WHERE user_id = ?${typeClause}
    ORDER BY created_at DESC
  `;

  return getConnection()
    .prepare(statement)
    .all(...parameters) as CredentialPublicRow[];
};

const createCredential = (
  userId: number,
  credentialName: string,
  credentialType: string,
  credentialValue: string,
  description: string | null = null
): CreateCredentialResult => {
  const inserted = getConnection()
    .prepare(`
      INSERT INTO user_credentials (
        user_id, credential_name, credential_type, credential_value, description
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId, credentialName, credentialType, credentialValue, description);

  return {
    id: inserted.lastInsertRowid,
    credentialName,
    credentialType,
  };
};

const getCredentials = (
  userId: number,
  credentialType: string | null = null
): CredentialPublicRow[] => listForUser(userId, credentialType);

const getActiveCredential = (
  userId: number,
  credentialType: string
): string | null => {
  const result = getConnection()
    .prepare(`
      SELECT credential_value
      FROM user_credentials
      WHERE user_id = ? AND credential_type = ? AND is_active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(userId, credentialType) as { credential_value: string } | undefined;

  return result === undefined ? null : result.credential_value;
};

const deleteCredential = (userId: number, credentialId: number): boolean => {
  const outcome = getConnection()
    .prepare('DELETE FROM user_credentials WHERE user_id = ? AND id = ?')
    .run(userId, credentialId);

  return didAffectRow(outcome.changes);
};

const toggleCredential = (
  userId: number,
  credentialId: number,
  isActive: boolean
): boolean => {
  const outcome = getConnection()
    .prepare(`
      UPDATE user_credentials
      SET is_active = ?
      WHERE user_id = ? AND id = ?
    `)
    .run(isActive ? 1 : 0, userId, credentialId);

  return didAffectRow(outcome.changes);
};

export const credentialsDb = {
  createCredential,
  getCredentials,
  getActiveCredential,
  deleteCredential,
  toggleCredential,
};
