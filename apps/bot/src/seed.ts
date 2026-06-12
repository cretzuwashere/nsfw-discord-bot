import { createDatabase, seed } from '@botplatform/database';

/**
 * CLI: idempotent bootstrap (modules + first admin user). Bundled into the
 * production image for the prod compose `seed` one-shot service.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const database = createDatabase(databaseUrl);
seed(database.db, {
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  e2eAdminEmail: process.env.E2E_ADMIN_EMAIL,
  e2eAdminPassword: process.env.E2E_ADMIN_PASSWORD,
  log: (message) => console.log(message),
})
  .then(() => console.log('seed complete'))
  .catch((error) => {
    console.error('seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void database.close());
