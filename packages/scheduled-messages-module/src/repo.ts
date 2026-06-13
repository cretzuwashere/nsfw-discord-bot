import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type ScheduledMessageRow = typeof schema.scheduledMessages.$inferSelect;
export type NewScheduledMessage = typeof schema.scheduledMessages.$inferInsert;

export function createScheduledMessageRepo(db: Db) {
  const t = schema.scheduledMessages;
  const runs = schema.scheduledMessageRuns;
  return {
    async create(input: NewScheduledMessage): Promise<ScheduledMessageRow> {
      const rows = await db.insert(t).values(input).returning();
      if (!rows[0]) throw new Error('failed to create scheduled message');
      return rows[0];
    },
    async update(id: string, patch: Partial<NewScheduledMessage>): Promise<ScheduledMessageRow | undefined> {
      const rows = await db.update(t).set({ ...patch, updatedAt: sql`now()` }).where(eq(t.id, id)).returning();
      return rows[0];
    },
    async getById(id: string): Promise<ScheduledMessageRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return rows[0];
    },
    async listByGuild(guildId: string): Promise<ScheduledMessageRow[]> {
      return db.select().from(t).where(eq(t.guildId, guildId)).orderBy(desc(t.createdAt));
    },
    async countByGuild(guildId: string): Promise<number> {
      const rows = await db.select({ v: sql<number>`count(*)::int` }).from(t).where(eq(t.guildId, guildId));
      return rows[0]?.v ?? 0;
    },
    async listDue(now: Date): Promise<ScheduledMessageRow[]> {
      return db
        .select()
        .from(t)
        .where(and(eq(t.paused, false), isNotNull(t.nextRunAt), lte(t.nextRunAt, now)))
        .limit(50);
    },
    async delete(id: string): Promise<void> {
      await db.delete(t).where(eq(t.id, id));
    },
    async recordRun(scheduledMessageId: string, status: string, detail?: string): Promise<void> {
      await db.insert(runs).values({ scheduledMessageId, status, detail: detail ?? null });
    },
    async listRuns(scheduledMessageId: string, limit = 20): Promise<(typeof runs.$inferSelect)[]> {
      return db
        .select()
        .from(runs)
        .where(eq(runs.scheduledMessageId, scheduledMessageId))
        .orderBy(desc(runs.ranAt))
        .limit(Math.min(limit, 100));
    },
  };
}

export type ScheduledMessageRepo = ReturnType<typeof createScheduledMessageRepo>;
