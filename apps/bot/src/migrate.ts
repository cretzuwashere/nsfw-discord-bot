/* eslint-disable no-console */
import { runMigrations } from '@botplatform/database';

/**
 * CLI: apply database migrations. Bundled into the production image
 * (the prod compose `migrate` one-shot service runs `node dist/migrate.js`
 * with MIGRATIONS_DIR=/app/migrations).
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

runMigrations(databaseUrl)
  .then(() => {
    console.log('migrations applied');
  })
  .catch((error) => {
    console.error('migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
