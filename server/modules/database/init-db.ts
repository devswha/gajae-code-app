import { getConnection } from '@/modules/database/connection.js';
import { runMigrations } from '@/modules/database/migrations.js';
import { INIT_SCHEMA_SQL } from '@/modules/database/schema.js';

const applySchemaAndMigrations = (): void => {
  const database = getConnection();
  database.exec(INIT_SCHEMA_SQL);
  console.log('Database schema applied');
  runMigrations(database);
};

const logInitializationFailure = (failure: unknown): void => {
  const message = failure instanceof Error ? failure.message : String(failure);
  console.log('Database initialization failed', { error: message });
};

export async function initializeDatabase(): Promise<void> {
  try {
    applySchemaAndMigrations();
  } catch (failure) {
    logInitializationFailure(failure);
    throw failure;
  }
}
