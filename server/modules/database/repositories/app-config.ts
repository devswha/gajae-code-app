import { getConnection } from '@/modules/database/connection.js';

type ConfigEntry = { value: string };

const readConfigValue = (configKey: string): string | null => {
  let result: ConfigEntry | undefined;

  try {
    const statement = [
      'SELECT value',
      'FROM app_config',
      'WHERE key = ?',
    ].join(' ');
    result = getConnection().prepare(statement).get(configKey) as ConfigEntry | undefined;
  } catch {
    return null;
  }

  return result?.value ?? null;
};

const storeConfigValue = (configKey: string, configValue: string): void => {
  const statement = `
    INSERT INTO app_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `;

  getConnection().prepare(statement).run(configKey, configValue);
};

export const appConfigDb = {
  get: readConfigValue,
  set: storeConfigValue,
};
