import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type ModerationCaseRow = typeof schema.moderationCases.$inferSelect;
export type NewModerationCase = typeof schema.moderationCases.$inferInsert;
export type ModerationSettingsRow = typeof schema.moderationSettings.$inferSelect;

export function createModerationCasesRepo(db: Db) {
  const cases = schema.moderationCases;
  const settings = schema.moderationSettings;
  return {
    async nextCaseNumber(guildId: string): Promise<number> {
      const rows = await db
        .select({ max: sql<number>`coalesce(max(${cases.caseNumber}), 0)::int` })
        .from(cases)
        .where(eq(cases.guildId, guildId));
      return (rows[0]?.max ?? 0) + 1;
    },

    async create(input: Omit<NewModerationCase, 'caseNumber'>): Promise<ModerationCaseRow> {
      // Retry once on the rare unique-collision of a concurrent case number.
      for (let attempt = 0; attempt < 3; attempt++) {
        const caseNumber = await this.nextCaseNumber(input.guildId);
        try {
          const rows = await db.insert(cases).values({ ...input, caseNumber }).returning();
          if (rows[0]) return rows[0];
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      throw new Error('failed to create moderation case');
    },

    async listByGuild(guildId: string, limit = 50): Promise<ModerationCaseRow[]> {
      return db
        .select()
        .from(cases)
        .where(eq(cases.guildId, guildId))
        .orderBy(desc(cases.createdAt))
        .limit(Math.min(limit, 200));
    },

    async listByUser(guildId: string, userExternalId: string): Promise<ModerationCaseRow[]> {
      return db
        .select()
        .from(cases)
        .where(and(eq(cases.guildId, guildId), eq(cases.targetUserExternalId, userExternalId)))
        .orderBy(desc(cases.createdAt))
        .limit(100);
    },

    async getSettings(guildId: string): Promise<ModerationSettingsRow | undefined> {
      const rows = await db.select().from(settings).where(eq(settings.guildId, guildId)).limit(1);
      return rows[0];
    },

    async upsertSettings(
      guildId: string,
      patch: Partial<typeof settings.$inferInsert>
    ): Promise<ModerationSettingsRow> {
      const rows = await db
        .insert(settings)
        .values({ guildId, ...patch })
        .onConflictDoUpdate({ target: settings.guildId, set: { ...patch, updatedAt: sql`now()` } })
        .returning();
      if (!rows[0]) throw new Error('failed to upsert moderation settings');
      return rows[0];
    },
  };
}

export type ModerationCasesRepo = ReturnType<typeof createModerationCasesRepo>;
