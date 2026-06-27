import { and, eq, isNotNull } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type PromptSettingsRow = typeof schema.promptSettings.$inferSelect;

export interface PromptConfigInput {
  qotdChannelId: string;
  qotdEnabled: boolean;
  qotdHourUtc: number;
}

export function createPromptRepo(db: Db) {
  const t = schema.promptSettings;
  return {
    async get(guildId: string): Promise<PromptSettingsRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.guildId, guildId)).limit(1);
      return rows[0];
    },
    async ensure(guildId: string): Promise<PromptSettingsRow> {
      await db.insert(t).values({ guildId }).onConflictDoNothing();
      const rows = await db.select().from(t).where(eq(t.guildId, guildId)).limit(1);
      if (!rows[0]) throw new Error('failed to ensure prompt settings');
      return rows[0];
    },
    async setRecent(guildId: string, recent: Record<string, number[]>): Promise<void> {
      await db.update(t).set({ recent, updatedAt: new Date() }).where(eq(t.guildId, guildId));
    },
    async setConfig(guildId: string, cfg: PromptConfigInput): Promise<void> {
      await db
        .insert(t)
        .values({ guildId, ...cfg })
        .onConflictDoUpdate({ target: t.guildId, set: { ...cfg, updatedAt: new Date() } });
    },
    async markQotdPosted(guildId: string, date: string): Promise<void> {
      await db.update(t).set({ lastQotdDate: date, updatedAt: new Date() }).where(eq(t.guildId, guildId));
    },
    async listEnabledDaily(): Promise<PromptSettingsRow[]> {
      return db
        .select()
        .from(t)
        .where(and(eq(t.qotdEnabled, true), isNotNull(t.qotdChannelId)));
    },
  };
}

export type PromptRepo = ReturnType<typeof createPromptRepo>;
