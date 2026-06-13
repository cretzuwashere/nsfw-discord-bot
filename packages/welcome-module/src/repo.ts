import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type WelcomeSettingsRow = typeof schema.welcomeSettings.$inferSelect;
export type WelcomeSettingsPatch = Partial<typeof schema.welcomeSettings.$inferInsert>;

export function createWelcomeRepo(db: Db) {
  const t = schema.welcomeSettings;
  return {
    async get(guildId: string): Promise<WelcomeSettingsRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.guildId, guildId)).limit(1);
      return rows[0];
    },

    async upsert(guildId: string, patch: WelcomeSettingsPatch): Promise<WelcomeSettingsRow> {
      const rows = await db
        .insert(t)
        .values({ guildId, ...patch })
        .onConflictDoUpdate({ target: t.guildId, set: { ...patch, updatedAt: sql`now()` } })
        .returning();
      if (!rows[0]) throw new Error('failed to upsert welcome settings');
      return rows[0];
    },
  };
}

export type WelcomeRepo = ReturnType<typeof createWelcomeRepo>;
