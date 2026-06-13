import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type AutomodRuleRow = typeof schema.automodRules.$inferSelect;
export type NewAutomodRule = typeof schema.automodRules.$inferInsert;
export type AutomodViolationRow = typeof schema.automodViolations.$inferSelect;

export function createAutomodRepo(db: Db) {
  const rules = schema.automodRules;
  const violations = schema.automodViolations;
  return {
    async create(input: NewAutomodRule): Promise<AutomodRuleRow> {
      const rows = await db.insert(rules).values(input).returning();
      if (!rows[0]) throw new Error('failed to create automod rule');
      return rows[0];
    },
    async update(id: string, patch: Partial<NewAutomodRule>): Promise<AutomodRuleRow | undefined> {
      const rows = await db.update(rules).set({ ...patch, updatedAt: sql`now()` }).where(eq(rules.id, id)).returning();
      return rows[0];
    },
    async getById(id: string): Promise<AutomodRuleRow | undefined> {
      const rows = await db.select().from(rules).where(eq(rules.id, id)).limit(1);
      return rows[0];
    },
    async listByGuild(guildId: string): Promise<AutomodRuleRow[]> {
      return db.select().from(rules).where(eq(rules.guildId, guildId)).orderBy(desc(rules.createdAt));
    },
    async enabledForGuild(guildId: string): Promise<AutomodRuleRow[]> {
      return db.select().from(rules).where(and(eq(rules.guildId, guildId), eq(rules.enabled, true)));
    },
    async delete(id: string): Promise<void> {
      await db.delete(rules).where(eq(rules.id, id));
    },
    async recordViolation(input: typeof violations.$inferInsert): Promise<void> {
      await db.insert(violations).values(input);
    },
    async recentViolations(guildId: string, limit = 50): Promise<AutomodViolationRow[]> {
      return db
        .select()
        .from(violations)
        .where(eq(violations.guildId, guildId))
        .orderBy(desc(violations.createdAt))
        .limit(Math.min(limit, 200));
    },
    async countUserViolations(guildId: string, userExternalId: string, since: Date): Promise<number> {
      const rows = await db
        .select({ v: sql<number>`count(*)::int` })
        .from(violations)
        .where(
          and(
            eq(violations.guildId, guildId),
            eq(violations.userExternalId, userExternalId),
            gte(violations.createdAt, since)
          )
        );
      return rows[0]?.v ?? 0;
    },
  };
}

export type AutomodRepo = ReturnType<typeof createAutomodRepo>;
