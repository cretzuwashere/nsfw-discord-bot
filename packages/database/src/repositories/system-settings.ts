import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { systemSettings } from '../schema.js';

export type SystemSettingRow = typeof systemSettings.$inferSelect;

export function createSystemSettingsRepo(db: Db) {
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const rows = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1);
      return rows[0]?.value as T | undefined;
    },

    async set(key: string, value: unknown): Promise<void> {
      await db
        .insert(systemSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value, updatedAt: sql`now()` },
        });
    },

    async all(): Promise<SystemSettingRow[]> {
      return db.select().from(systemSettings).orderBy(systemSettings.key);
    },
  };
}

export type SystemSettingsRepo = ReturnType<typeof createSystemSettingsRepo>;
