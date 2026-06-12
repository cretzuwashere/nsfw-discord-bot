/**
 * Vitest globalSetup for the 'integration' project (wired in root
 * vitest.config.ts). Ensures the dedicated test database exists and is fully
 * migrated before any integration test file runs.
 */
import pg from 'pg';
import { resolveTestDatabaseUrl, runMigrations } from '@botplatform/database';

export default async function setup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  const databaseName = new URL(testUrl).pathname.replace(/^\//, '');

  // The name comes from our own configuration, but it is interpolated into
  // DDL (CREATE DATABASE cannot be parameterized) — so allow only a strict
  // identifier alphabet before quoting it.
  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(
      `Refusing to create test database: name ${JSON.stringify(databaseName)} ` +
        'must match /^[a-z0-9_]+$/.'
    );
  }

  await ensureDatabaseExists(testUrl, databaseName);

  console.log('[integration-setup] running migrations against the test database');
  await runMigrations(testUrl);
  console.log('[integration-setup] test database ready');
}

/** Connect to the maintenance 'postgres' database and create the test DB if missing. */
async function ensureDatabaseExists(testUrl: string, databaseName: string): Promise<void> {
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ]);
    if (existing.rows.length > 0) {
      console.log(`[integration-setup] test database "${databaseName}" already exists`);
      return;
    }
    console.log(`[integration-setup] creating test database "${databaseName}"`);
    await client.query(`create database "${databaseName}"`);
  } finally {
    await client.end();
  }
}
