import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  pingDatabase,
  resolveTestDatabaseUrl,
  type Database,
} from '../../src/index.js';

const EXPECTED_TABLES = [
  'admin_users',
  'modules',
  'guilds',
  'guild_settings',
  'platform_users',
  'warnings',
  'moderation_actions',
  'moderation_rules',
  'permission_mappings',
  'audit_logs',
  'playback_history',
  'queue_items',
  'system_settings',
  'module_settings',
];

let database: Database;

beforeAll(() => {
  database = createDatabase(resolveTestDatabaseUrl());
});

afterAll(async () => {
  await database.close();
});

describe('migrations', () => {
  it('connects to the test database and answers a ping', async () => {
    await expect(pingDatabase(database.db)).resolves.toBeUndefined();
  });

  it('created every expected table', async () => {
    const result = await database.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`
    );
    const tableNames = result.rows.map((row) => String(row.table_name));
    for (const table of EXPECTED_TABLES) {
      expect(tableNames, `missing table "${table}"`).toContain(table);
    }
  });
});
