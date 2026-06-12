import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.js';

/**
 * Apply pending migrations. Used by the migrate CLI (pnpm db:migrate) and
 * programmatically from integration tests.
 *
 * MIGRATIONS_DIR overrides the folder (used by production images where the
 * migrations are copied to a fixed path).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();
  const database = createDatabase(databaseUrl);
  try {
    await migrate(database.db, { migrationsFolder });
  } finally {
    await database.close();
  }
}

export function resolveMigrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../migrations', import.meta.url));
}
