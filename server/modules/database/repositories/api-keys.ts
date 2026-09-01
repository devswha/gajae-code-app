import { randomBytes } from 'crypto';

import { getConnection } from '@/modules/database/connection.js';

interface ApiKeyRow { api_key: string; created_at: string; id: number; is_active: number; key_name: string; last_used: string | null }

interface CreateApiKeyResult { apiKey: string; id: number | bigint; keyName: string }

interface ValidatedApiKeyUser { api_key_id: number; id: number; username: string }

const generateApiKey = (): string => `ck_${randomBytes(32).toString('hex')}`;

const createApiKey = (userId: number, keyName: string): CreateApiKeyResult => {
  const value = generateApiKey();
  const saved = getConnection()
    .prepare(`
      INSERT INTO api_keys (user_id, key_name, api_key)
      VALUES (?, ?, ?)
    `)
    .run(userId, keyName, value);

  return { id: saved.lastInsertRowid, keyName, apiKey: value };
};

const getApiKeys = (userId: number): ApiKeyRow[] =>
  getConnection()
    .prepare(`
      SELECT id, key_name, api_key, created_at, last_used, is_active
      FROM api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC
    `)
    .all(userId) as ApiKeyRow[];

const validateApiKey = (apiKey: string): ValidatedApiKeyUser | undefined => {
  const database = getConnection();
  const owner = database
    .prepare(`
      SELECT users.id, users.username, api_keys.id AS api_key_id
      FROM api_keys
      INNER JOIN users ON users.id = api_keys.user_id
      WHERE api_keys.api_key = ? AND api_keys.is_active = 1 AND users.is_active = 1
    `)
    .get(apiKey) as ValidatedApiKeyUser | undefined;

  if (owner === undefined) {
    return undefined;
  }

  database
    .prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?')
    .run(owner.api_key_id);
  return owner;
};

const deleteApiKey = (userId: number, apiKeyId: number): boolean => {
  const result = getConnection()
    .prepare('DELETE FROM api_keys WHERE user_id = ? AND id = ?')
    .run(userId, apiKeyId);

  return result.changes > 0;
};

const toggleApiKey = (
  userId: number,
  apiKeyId: number,
  isActive: boolean
): boolean => {
  const result = getConnection()
    .prepare(`
      UPDATE api_keys
      SET is_active = ?
      WHERE user_id = ? AND id = ?
    `)
    .run(isActive ? 1 : 0, userId, apiKeyId);

  return result.changes > 0;
};

export const apiKeysDb = {
  generateApiKey,
  createApiKey,
  getApiKeys,
  validateApiKey,
  deleteApiKey,
  toggleApiKey,
};
