import { runMigrations } from './migrate.js';

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
